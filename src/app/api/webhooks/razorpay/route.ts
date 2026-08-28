import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { AuditService } from "@/server/audit/service";
import { CheckoutService } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

// Razorpay webhook verification — HMAC SHA256 of raw body with webhook secret
function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(signature, "utf-8"));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: "WEBHOOK_SECRET_MISSING", message: "Webhook secret not configured" } },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? request.headers.get("X-Razorpay-Signature") ?? "";

  if (!signature) {
    await AuditService.log({
      eventType: "WEBHOOK_REJECTED_MISSING_SIGNATURE",
      isSimulated: false,
      verificationSource: "webhook_missing_signature",
    });
    return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "Missing webhook signature" } }, { status: 400 });
  }

  // Never process unverified body
  const isValid = verifyWebhookSignature(rawBody, signature, secret);
  if (!isValid) {
    await AuditService.log({
      eventType: "WEBHOOK_REJECTED_INVALID_SIGNATURE",
      isSimulated: false,
      verificationSource: "webhook_invalid_signature",
    });
    return NextResponse.json({ error: { code: "INVALID_SIGNATURE", message: "Invalid webhook signature" } }, { status: 400 });
  }

  // Only after verification, parse and extract fields — never trust amount
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid webhook JSON" } }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  let razorpayOrderId: string | null = null;
  let razorpayPaymentId: string | null = null;
  // payment entity status (e.g. "captured", "failed", "authorized") — informational only
  let paymentEntityStatus: string | null = null;
  // amount/currency from webhook are NEVER trusted for state — read for context only
  const eventType = (payload.event as string) ?? "unknown";

  try {
    const pl = payload.payload as Record<string, unknown> | undefined;
    if (pl) {
      const payment = pl.payment as Record<string, unknown> | undefined;
      const order = pl.order as Record<string, unknown> | undefined;
      const paymentEntity = payment?.entity as Record<string, unknown> | undefined;
      const orderEntity = order?.entity as Record<string, unknown> | undefined;
      razorpayOrderId = (paymentEntity?.order_id as string) ?? (orderEntity?.id as string) ?? null;
      razorpayPaymentId = (paymentEntity?.id as string) ?? null;
      if (paymentEntity?.status) paymentEntityStatus = String(paymentEntity.status);
    }
    // Alternative flat structure
    if (!razorpayOrderId) {
      razorpayOrderId = (payload.order_id as string) ?? (payload.razorpayOrderId as string) ?? null;
    }
    if (!razorpayPaymentId) {
      razorpayPaymentId = (payload.payment_id as string) ?? (payload.razorpayPaymentId as string) ?? null;
    }
    if (!paymentEntityStatus && payload.status) paymentEntityStatus = String(payload.status);
  } catch {
    // ignore extraction errors
  }

  if (!razorpayOrderId) {
    await AuditService.log({
      eventType: "WEBHOOK_RECEIVED_NO_ORDER",
      isSimulated: false,
      verificationSource: "webhook_no_order_id",
    });
    return NextResponse.json({ ok: true, message: "Webhook verified but no order_id found" }, { status: 200 });
  }

  // Find Transaction by razorpayOrderId — authoritative local record
  const txn = await prisma.transaction.findUnique({ where: { razorpayOrderId } });

  if (!txn) {
    await AuditService.log({
      eventType: "WEBHOOK_RECEIVED_UNKNOWN_ORDER",
      isSimulated: false,
      verificationSource: "webhook_unknown_order",
      cartHash: razorpayOrderId,
    });
    // Idempotent: acknowledge even if unknown to avoid retry storms, but don't process
    return NextResponse.json({ ok: true, message: "Order not found" }, { status: 200 });
  }

  // Always log the verified receipt first — even before state checks.
  // Use paymentEntityStatus as a free-form reason (no secrets here).
  await AuditService.log({
    eventType: "WEBHOOK_VERIFIED",
    transactionId: txn.id,
    cartId: txn.cartId,
    fromState: txn.status as unknown as string as never,
    toState: txn.status as unknown as string as never,
    cartHash: txn.cartHash,
    isSimulated: false,
    verificationSource: `webhook_${eventType}${paymentEntityStatus ? `:${paymentEntityStatus}` : ""}`,
  });

  // Idempotent handling — duplicate delivery on PAYMENT_SUCCESS
  if (txn.status === "PAYMENT_SUCCESS") {
    await AuditService.log({
      eventType: "WEBHOOK_IDEMPOTENT_SUCCESS",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: txn.status as unknown as string as never,
      toState: txn.status as unknown as string as never,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "webhook_idempotent",
    });
    return NextResponse.json({ ok: true, idempotent: true, transactionId: txn.id }, { status: 200 });
  }

  // Phase 9: payment.failed webhook handling
  // Transitions to PAYMENT_FAILED via CheckoutService.recordPaymentFailure
  // which guards against:
  //   - downgrading PAYMENT_SUCCESS (eventType alone never wins)
  //   - replay on PAYMENT_FAILED (idempotent)
  //   - invalid state transitions
  if (eventType === "payment.failed" || paymentEntityStatus === "failed") {
    const reason = razorpayPaymentId
      ? `razorpay_payment_failed:${razorpayPaymentId}`
      : "razorpay_payment_failed";
    const result = await CheckoutService.recordPaymentFailure({
      transactionId: txn.id,
      source: "payment_failed_webhook",
      reason,
    });
    if (result.status === "PAYMENT_SUCCESS") {
      // Defensive: webhook must never downgrade — already audited inside service
      return NextResponse.json(
        { ok: false, error: { code: "WEBHOOK_CANNOT_DOWNGRADE_SUCCESS", message: "Webhook cannot downgrade PAYMENT_SUCCESS" } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        ok: true,
        transactionId: txn.id,
        status: result.status,
        transitioned: result.transitioned,
        event: eventType,
      },
      { status: 200 }
    );
  }

  // Phase 9: payment.captured / payment.authorized are still audit-only.
  // Status transition is the verifyPayment flow's job (HMAC-verified).
  // Webhook amount is NEVER authoritative.
  return NextResponse.json({ ok: true, transactionId: txn.id, event: eventType }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
}
