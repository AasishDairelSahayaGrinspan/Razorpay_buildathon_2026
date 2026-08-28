import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { ApprovalService } from "@/server/approval/service";
import { CheckoutService } from "@/server/checkout/service";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";

// Deterministic webhook secret for tests — never commit real secret
const TEST_WEBHOOK_SECRET = "whsec_test_9f8b7a6c5d4e3f2a1b0c";

function signWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function buildWebhookPayload(opts: {
  event?: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amountTamper?: number;
}): Record<string, unknown> {
  const { event = "payment.captured", razorpayOrderId, razorpayPaymentId = "pay_test_" + Date.now(), amountTamper } = opts;
  const payload: Record<string, unknown> = {
    event,
    payload: {
      payment: {
        entity: {
          id: razorpayPaymentId,
          order_id: razorpayOrderId,
          // Razorpay amount is paise — we deliberately tamper here for amount authority test
          ...(amountTamper !== undefined ? { amount: amountTamper } : {}),
          currency: "INR",
          status: "captured",
        },
      },
      order: {
        entity: {
          id: razorpayOrderId,
        },
      },
    },
  };
  // Also add top-level amount to test that we don't trust it
  if (amountTamper !== undefined) {
    (payload as Record<string, unknown>).amount = amountTamper;
  }
  return payload;
}

async function callWebhook(rawBody: string, signature: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature !== null) headers["x-razorpay-signature"] = signature;
  const req = new Request("http://localhost/api/webhooks/razorpay", {
    method: "POST",
    headers,
    body: rawBody,
  });
  return webhookPOST(req as unknown as Request);
}

describe("Webhook — Phase 7", () => {
  let prod: Awaited<ReturnType<typeof CatalogService.listProducts>>[0];
  let originalWebhookSecret: string | undefined;

  beforeAll(async () => {
    originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    prod = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 5)!;
    if (!prod) throw new Error("No product with inventory>5");
  });

  afterAll(async () => {
    if (originalWebhookSecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    await prisma.auditEvent.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
  });

  beforeEach(async () => {
    // restore secret for each test (in case a test mutates env)
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  async function approvedCheckout() {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const { transaction } = await ApprovalService.approve(cart.id, fetched!.hash);
    const orderResult = await CheckoutService.createCheckoutOrder(transaction.id);
    const txn = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    return { cart, transaction: txn!, orderResult };
  }

  it("A. Valid signature — known razorpayOrderId succeeds and creates WEBHOOK_VERIFIED", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.transactionId).toBe(transaction.id);

    // Audit event WEBHOOK_VERIFIED created
    const audits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "WEBHOOK_VERIFIED" } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
    const last = audits[audits.length - 1];
    expect(last.verificationSource).toMatch(/^webhook_payment\.captured(:captured)?$/);
    expect(last.transactionId).toBe(transaction.id);
    // fromState/toState should equal current status (audit-only, no transition)
    // For PAYMENT_PENDING, fromState should be PAYMENT_PENDING
    expect(["PAYMENT_PENDING", "PAYMENT_PROCESSING"]).toContain(last.fromState);

    // Ensure amount authority: transaction total unchanged, webhook amount not trusted
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.total).toBe(transaction.total);
  });

  it("B. Missing signature — returns 400, no successful processing", async () => {
    const { orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId });
    const rawBody = JSON.stringify(payload);

    const res = await callWebhook(rawBody, null);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SIGNATURE");

    const audits = await prisma.auditEvent.findMany({ where: { eventType: "WEBHOOK_REJECTED_MISSING_SIGNATURE" } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("C. Invalid signature — returns 400, no payment success, no state mutation", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId });
    const rawBody = JSON.stringify(payload);
    // Wrong secret
    const badSig = signWebhook(rawBody, "whsec_wrong_secret_0000");

    const before = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    const res = await callWebhook(rawBody, badSig);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SIGNATURE");

    const after = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(after!.status).toBe(before!.status);
    expect(after!.status).not.toBe("PAYMENT_SUCCESS");

    const audits = await prisma.auditEvent.findMany({ where: { eventType: "WEBHOOK_REJECTED_INVALID_SIGNATURE" } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("D. Duplicate webhook — second invocation is idempotent, WEBHOOK_IDEMPOTENT_SUCCESS", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    // First, make transaction PAYMENT_SUCCESS via verifyPayment (real HMAC with RAZORPAY_KEY_SECRET)
    const paymentId = "pay_dup_" + Date.now();
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const msg = orderResult.razorpayOrderId + "|" + paymentId;
    const sig = createHmac("sha256", keySecret).update(msg).digest("hex");
    await CheckoutService.verifyPayment({
      transactionId: transaction.id,
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    });
    const afterSuccess = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(afterSuccess!.status).toBe("PAYMENT_SUCCESS");

    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId, razorpayPaymentId: paymentId });
    const rawBody = JSON.stringify(payload);
    const webhookSig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const first = await callWebhook(rawBody, webhookSig);
    expect(first.status).toBe(200);
    expect((await first.json()).idempotent).toBe(true);

    const second = await callWebhook(rawBody, webhookSig);
    expect(second.status).toBe(200);
    expect((await second.json()).idempotent).toBe(true);

    const audits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "WEBHOOK_IDEMPOTENT_SUCCESS" } });
    expect(audits.length).toBeGreaterThanOrEqual(2);

    // No duplicate successful payment transition — still single SUCCESS
    const finalTxn = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(finalTxn!.status).toBe("PAYMENT_SUCCESS");
  });

  it("E. Unknown order — valid HMAC, nonexistent razorpayOrderId returns safe unknown, no PAYMENT_SUCCESS", async () => {
    const fakeOrderId = "order_unknown_" + Date.now();
    const payload = buildWebhookPayload({ razorpayOrderId: fakeOrderId });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/Order not found/);

    const audits = await prisma.auditEvent.findMany({ where: { eventType: "WEBHOOK_RECEIVED_UNKNOWN_ORDER" } });
    // At least one unknown order audit should exist with cartHash == fakeOrderId
    const recent = audits.filter((a) => a.cartHash === fakeOrderId);
    expect(recent.length).toBeGreaterThanOrEqual(1);

    // MUST NOT have created a transaction with PAYMENT_SUCCESS for this fake order
    const fakeTxn = await prisma.transaction.findUnique({ where: { razorpayOrderId: fakeOrderId } });
    expect(fakeTxn).toBeNull();
  });

  it("F. Approval bypass — webhook cannot create PAYMENT_SUCCESS without APPROVED→ORDER_CREATED", async () => {
    // Case 1: cart approved but no checkout — no razorpayOrderId exists, webhook with random order must be unknown
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const { transaction: approvedTxn } = await ApprovalService.approve(cart.id, fetched!.hash);
    expect(approvedTxn.status).toBe("APPROVED");
    expect(approvedTxn.razorpayOrderId).toBeNull();

    const fakeOrderId = "order_bypass_" + Date.now();
    const payload = buildWebhookPayload({ razorpayOrderId: fakeOrderId });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);
    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/Order not found/);

    // Case 2: manually create a txn in APPROVED with a razorpayOrderId but status not PENDING — webhook must not transition to SUCCESS
    const bypassOrderId = "order_bypass2_" + Date.now();
    // Create a second cart/transaction for this bypass test
    const cart2 = await CartService.createCart();
    await CartService.addItem(cart2.id, prod.id, 1);
    const fetched2 = await CartService.getCart(cart2.id);
    const { transaction: txn2 } = await ApprovalService.approve(cart2.id, fetched2!.hash);
    // Manually set razorpayOrderId but keep status APPROVED (invalid checkout flow)
    await prisma.transaction.update({ where: { id: txn2.id }, data: { razorpayOrderId: bypassOrderId } });
    const txn2Updated = await prisma.transaction.findUnique({ where: { id: txn2.id } });
    expect(txn2Updated!.status).toBe("APPROVED");

    const payload2 = buildWebhookPayload({ razorpayOrderId: bypassOrderId });
    const rawBody2 = JSON.stringify(payload2);
    const sig2 = signWebhook(rawBody2, TEST_WEBHOOK_SECRET);
    const res2 = await callWebhook(rawBody2, sig2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.ok).toBe(true);
    // Status must remain APPROVED, never PAYMENT_SUCCESS via webhook alone
    const after2 = await prisma.transaction.findUnique({ where: { id: txn2.id } });
    expect(after2!.status).toBe("APPROVED");
    expect(after2!.status).not.toBe("PAYMENT_SUCCESS");
  });

  it("G. Amount authority — webhook amount never overwrites server-authoritative total", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const originalTotal = transaction.total;
    const tamperedAmount = 1; // 1 paise vs real e.g. 399900
    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId, amountTamper: tamperedAmount });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);

    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.total).toBe(originalTotal);
    expect(fresh!.total).not.toBe(tamperedAmount);

    // Also snapshot total must be unchanged
    const snap = JSON.parse(fresh!.snapshot);
    expect(snap.total).toBe(originalTotal);
  });

  it("HMAC uses rawBody — JSON with same logical content but different whitespace fails if not signed correctly", async () => {
    const { orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({ razorpayOrderId: orderResult.razorpayOrderId });
    const rawBody = JSON.stringify(payload);
    // Sign with correct rawBody
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);
    // Send with rawBody that has extra space — signature should fail because we verify against rawBody
    const tamperedRawBody = rawBody.replace(/":/g, '": ');
    const res = await callWebhook(tamperedRawBody, sig);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SIGNATURE");
  });

  it("GET returns 405", async () => {
    const { GET } = await import("@/app/api/webhooks/razorpay/route");
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
