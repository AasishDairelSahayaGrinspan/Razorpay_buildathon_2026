import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { AuditService } from "@/server/audit/service";

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
    // In TEST mode without webhook secret configured, fail closed — do not process unverified
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
  // Razorpay webhook structure varies by event; try common paths
  // Typical: { event: "payment.captured", payload: { payment: { entity: { id, order_id } }, order: { entity: { id } } } }
  // Fallback: extract order_id/payment_id from various places
  let razorpayOrderId: string | null = null;
  let razorpayPaymentId: string | null = null;
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
    }
    // Alternative flat structure
    if (!razorpayOrderId) {
      razorpayOrderId = (payload.order_id as string) ?? (payload.razorpayOrderId as string) ?? null;
    }
    if (!razorpayPaymentId) {
      razorpayPaymentId = (payload.payment_id as string) ?? (payload.razorpayPaymentId as string) ?? null;
    }
    // If payload is payment entity directly
    if (!razorpayOrderId && payload.order_id) razorpayOrderId = payload.order_id as string;
  } catch {
    // ignore extraction errors
  }

  if (!razorpayOrderId) {
    // No order to correlate — still acknowledge but audit
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

  // Idempotent handling — duplicate delivery
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

  // Never trust webhook amount — amount is not used. Just audit the verified event.
  // Do not implement refunds/subscriptions/captures per Phase 6 spec.
  // For Phase 6, webhook is audit-only; state transitions happen via verifyPayment flow.
  // If webhook indicates payment captured but local is still pending, we still just audit and idempotently note.
  // Optionally, if txn is PAYMENT_PENDING/PROCESSING and event is payment.captured, we could mark processing, but keep as audit-only to avoid Phase 7 logic.

  await AuditService.log({
    eventType: "WEBHOOK_VERIFIED",
    transactionId: txn.id,
    cartId: txn.cartId,
    fromState: txn.status as unknown as string as never,
    toState: txn.status as unknown as string as never,
    cartHash: txn.cartHash,
    isSimulated: false,
    verificationSource: `webhook_${eventType}`,
  });

  // Also log receipt without changing state — webhook is not authoritative for amount/status beyond audit
  // If you want to record paymentId from webhook without trusting it for success, you could store but not transition.
  // We will NOT auto-transition to PAYMENT_SUCCESS via webhook — that is verifyPayment's job.
  // This keeps webhook idempotent and safe.

  return NextResponse.json({ ok: true, transactionId: txn.id, event: eventType }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
}
