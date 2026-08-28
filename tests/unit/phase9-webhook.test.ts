import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { ApprovalService } from "@/server/approval/service";
import { CheckoutService } from "@/server/checkout/service";
import { __setRazorpayClient, type RazorpayClient } from "@/server/razorpay/client";
import { POST as webhookPOST } from "@/app/api/webhooks/razorpay/route";

const TEST_WEBHOOK_SECRET = "whsec_test_9f8b7a6c5d4e3f2a1b0c";

function signWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

function buildWebhookPayload(opts: {
  event: string;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  paymentStatus?: string;
  amountTamper?: number;
}): Record<string, unknown> {
  const { event, razorpayOrderId, razorpayPaymentId = "pay_test_" + Date.now(), paymentStatus, amountTamper } = opts;
  const entity: Record<string, unknown> = {
    id: razorpayPaymentId,
    order_id: razorpayOrderId,
    currency: "INR",
  };
  if (paymentStatus) entity.status = paymentStatus;
  if (amountTamper !== undefined) entity.amount = amountTamper;
  return {
    event,
    payload: {
      payment: { entity },
      order: { entity: { id: razorpayOrderId } },
    },
  };
}

async function callWebhook(rawBody: string, signature: string | null): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["x-razorpay-signature"] = signature;
  const req = new Request("http://localhost/api/webhooks/razorpay", {
    method: "POST",
    headers,
    body: rawBody,
  });
  return webhookPOST(req as unknown as Request);
}

function makeFakeRzp(): RazorpayClient & { calls: number } {
  return {
    calls: 0,
    async createOrder(input) {
      this.calls += 1;
      return {
        id: "order_fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
      };
    },
  };
}

describe("Phase 9 — Webhook payment.failed, idempotency, downgrade protection", () => {
  let prod: Awaited<ReturnType<typeof CatalogService.listProducts>>[0];
  let originalWebhookSecret: string | undefined;

  beforeAll(async () => {
    originalWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    prod = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 5)!;
    if (!prod) throw new Error("No product with inventory>5");
    __setRazorpayClient(makeFakeRzp());
  });

  afterAll(async () => {
    if (originalWebhookSecret !== undefined) process.env.RAZORPAY_WEBHOOK_SECRET = originalWebhookSecret;
    else delete process.env.RAZORPAY_WEBHOOK_SECRET;
    __setRazorpayClient(null);
    await prisma.auditEvent.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
  });

  beforeEach(() => {
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

  it("WEBHOOK payment.failed: valid signature on PAYMENT_PENDING → PAYMENT_FAILED, audit logged", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId: "pay_fail_" + Date.now(),
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("PAYMENT_FAILED");
    expect(body.transitioned).toBe(true);

    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_FAILED");
    expect(fresh!.paymentStatus).toBe("failed");

    const audits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "STATE_TRANSITION" }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] });
    const fromTo = audits.map((a) => `${a.fromState}->${a.toState}`);
    expect(fromTo).toContain("PAYMENT_PENDING->PAYMENT_FAILED");

    const failAudits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "PAYMENT_FAILED" } });
    expect(failAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("WEBHOOK payment.failed: cannot downgrade PAYMENT_SUCCESS (idempotent path)", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    // Force PAYMENT_SUCCESS
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "PAYMENT_SUCCESS", razorpayPaymentId: "pay_x_success", paymentStatus: "captured" },
    });
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId: "pay_late_fail",
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    // Webhook on PAYMENT_SUCCESS is idempotent — does not transition
    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.transactionId).toBe(transaction.id);

    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_SUCCESS");
    // No PAYMENT_FAILURE audit logged because we never reached recordPaymentFailure
    const failAudits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "STATE_TRANSITION", toState: "PAYMENT_FAILED" } });
    expect(failAudits.length).toBe(0);
  });

  it("recordPaymentFailure directly: cannot downgrade PAYMENT_SUCCESS (audited)", async () => {
    const { transaction } = await approvedCheckout();
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "PAYMENT_SUCCESS", razorpayPaymentId: "pay_y", paymentStatus: "captured" },
    });
    const r = await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "x" });
    expect(r.transitioned).toBe(false);
    expect(r.status).toBe("PAYMENT_SUCCESS");
    const downgradeAudits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "PAYMENT_FAILURE_DOWNGRADE_REJECTED" } });
    expect(downgradeAudits.length).toBeGreaterThanOrEqual(1);
  });

  it("WEBHOOK payment.failed: duplicate delivery is idempotent (no second transition)", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId: "pay_dup_fail",
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const first = await callWebhook(rawBody, sig);
    expect(first.status).toBe(200);
    expect((await first.json()).transitioned).toBe(true);

    const second = await callWebhook(rawBody, sig);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.status).toBe("PAYMENT_FAILED");
    expect(secondBody.transitioned).toBe(false);

    const failAudits = await prisma.auditEvent.findMany({ where: { transactionId: transaction.id, eventType: "STATE_TRANSITION", toState: "PAYMENT_FAILED" } });
    expect(failAudits.length).toBe(1);
  });

  it("WEBHOOK payment.failed: invalid signature → 400, no state mutation", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const before = (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!.status;
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const badSig = signWebhook(rawBody, "whsec_wrong_secret_0000");

    const res = await callWebhook(rawBody, badSig);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SIGNATURE");

    const after = (await prisma.transaction.findUnique({ where: { id: transaction.id } }))!.status;
    expect(after).toBe(before);
    expect(after).not.toBe("PAYMENT_FAILED");
  });

  it("WEBHOOK payment.failed: missing signature → 400, no state mutation", async () => {
    const { orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);

    const res = await callWebhook(rawBody, null);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_SIGNATURE");
  });

  it("WEBHOOK payment.failed: unknown razorpayOrderId → 200 safe, no transaction created", async () => {
    const fakeOrderId = "order_unknown_failed_" + Date.now();
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: fakeOrderId,
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/Order not found/);

    const fakeTxn = await prisma.transaction.findUnique({ where: { razorpayOrderId: fakeOrderId } });
    expect(fakeTxn).toBeNull();
  });

  it("WEBHOOK payment.failed: amount in payload is never trusted (server total preserved)", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const originalTotal = transaction.total;
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      amountTamper: 1, // 1 paise
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);

    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.total).toBe(originalTotal);
    expect(fresh!.total).not.toBe(1);
    expect(fresh!.status).toBe("PAYMENT_FAILED");
  });

  it("WEBHOOK payment.captured: remains audit-only (no auto-SUCCESS)", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const payload = buildWebhookPayload({
      event: "payment.captured",
      razorpayOrderId: orderResult.razorpayOrderId,
      paymentStatus: "captured",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);

    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);

    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_PENDING");
    expect(fresh!.status).not.toBe("PAYMENT_SUCCESS");
  });

  it("WEBHOOK payment.failed: amount authority preserved (server total still wins, FAIL transition only)", async () => {
    const { transaction, orderResult } = await approvedCheckout();
    const originalTotal = transaction.total;
    const payload = buildWebhookPayload({
      event: "payment.failed",
      razorpayOrderId: orderResult.razorpayOrderId,
      amountTamper: 99999999,
      paymentStatus: "failed",
    });
    const rawBody = JSON.stringify(payload);
    const sig = signWebhook(rawBody, TEST_WEBHOOK_SECRET);
    const res = await callWebhook(rawBody, sig);
    expect(res.status).toBe(200);
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_FAILED");
    expect(fresh!.total).toBe(originalTotal);
  });
});
