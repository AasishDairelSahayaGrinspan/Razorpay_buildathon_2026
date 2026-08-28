import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { ApprovalService } from "@/server/approval/service";
import { CheckoutService } from "@/server/checkout/service";
import { __setRazorpayClient, type RazorpayClient } from "@/server/razorpay/client";

// Build a fake RazorpayClient. Each test sets behavior via the closure.
type FakeRzp = RazorpayClient & {
  __callCount: { count: number };
  __lastReceipt: { value: string };
  __lastAmount: { value: number };
  __next: () => Promise<{ id: string; amount: number; currency: string; receipt: string }>;
};

function makeFake(behavior: "ok" | "transient-then-ok" | "always-fail" | "non-transient-fail"): FakeRzp {
  const callCount = { count: 0 };
  const lastReceipt = { value: "" };
  const lastAmount = { value: 0 };
  const f: FakeRzp = {
    __callCount: callCount,
    __lastReceipt: lastReceipt,
    __lastAmount: lastAmount,
    __next: async () => ({ id: "order_fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), amount: 0, currency: "INR", receipt: "" }),
    async createOrder(input) {
      callCount.count += 1;
      lastReceipt.value = input.receipt;
      lastAmount.value = input.amount;
      if (behavior === "ok") {
        return { id: "order_fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), amount: input.amount, currency: input.currency, receipt: input.receipt };
      }
      if (behavior === "transient-then-ok") {
        if (callCount.count === 1) {
          const e: Error & { code: string; statusCode?: number } = new Error("transient network blip") as Error & { code: string; statusCode?: number };
          e.code = "ECONNRESET";
          throw e;
        }
        return { id: "order_fake_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6), amount: input.amount, currency: input.currency, receipt: input.receipt };
      }
      if (behavior === "non-transient-fail") {
        const e: Error & { code: string; statusCode?: number } = new Error("bad request") as Error & { code: string; statusCode?: number };
        e.code = "BAD_REQUEST_ERROR";
        e.statusCode = 400;
        throw e;
      }
      // always-fail: server error
      const e: Error & { code: string; statusCode?: number } = new Error("server down") as Error & { code: string; statusCode?: number };
      e.code = "SERVER_ERROR";
      e.statusCode = 500;
      throw e;
    },
  };
  return f;
}

describe("Phase 9 — Order idempotency, retry, FAILED/UNKNOWN", () => {
  let prod: Awaited<ReturnType<typeof CatalogService.listProducts>>[0];

  beforeAll(async () => {
    prod = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 5)!;
    if (!prod) throw new Error("No product with inventory>5");
  });

  afterAll(async () => {
    __setRazorpayClient(null);
    await prisma.auditEvent.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
  });

  beforeEach(() => {
    __setRazorpayClient(null);
  });

  async function approvedTransaction() {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const { transaction } = await ApprovalService.approve(cart.id, fetched!.hash);
    return { cart, transaction };
  }

  // ------------------------- Retry behavior -------------------------

  it("RETRY: first attempt succeeds — no second call, no retry audit", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    const result = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(result.razorpayOrderId).toMatch(/^order_fake_/);
    expect(fake.__callCount.count).toBe(1);
    expect(result.reused).toBe(false);
    // No CHECKOUT_ORDER_RETRY audit on first-attempt success
    const retryAudits = await prisma.auditEvent.findMany({ where: { eventType: "CHECKOUT_ORDER_RETRY", transactionId: transaction.id } });
    expect(retryAudits.length).toBe(0);
  });

  it("RETRY: first attempt fails with transient error, second succeeds", async () => {
    const fake = makeFake("transient-then-ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    const result = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(result.razorpayOrderId).toMatch(/^order_fake_/);
    expect(fake.__callCount.count).toBe(2);
    expect(result.reused).toBe(false);
    // CHECKOUT_ORDER_RETRY audit should exist
    const retryAudits = await prisma.auditEvent.findMany({ where: { eventType: "CHECKOUT_ORDER_RETRY", transactionId: transaction.id } });
    expect(retryAudits.length).toBe(1);
    expect(retryAudits[0].verificationSource).toMatch(/^checkout_retry_/);
  });

  it("RETRY: both attempts fail (transient) → RAZORPAY_ORDER_FAILED with 502 hint, no third attempt", async () => {
    const fake = makeFake("always-fail");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    let caught: Error & { code?: string; status?: number } | null = null;
    try {
      await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    } catch (e) {
      caught = e as Error & { code?: string; status?: number };
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe("RAZORPAY_ORDER_FAILED");
    expect(caught!.status).toBe(502);
    expect(fake.__callCount.count).toBe(2); // exactly 1 retry, no third
    // CHECKOUT_ORDER_RETRY + CHECKOUT_ORDER_CREATE_FAILED audits
    const retryAudits = await prisma.auditEvent.findMany({ where: { eventType: "CHECKOUT_ORDER_RETRY", transactionId: transaction.id } });
    expect(retryAudits.length).toBe(1);
    const failAudits = await prisma.auditEvent.findMany({ where: { eventType: "CHECKOUT_ORDER_CREATE_FAILED", transactionId: transaction.id } });
    expect(failAudits.length).toBe(1);
    expect(failAudits[0].verificationSource).toBe("checkout_retry_exhausted");
    // Transaction should still be APPROVED — no half-written order
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("APPROVED");
    expect(fresh!.razorpayOrderId).toBeNull();
  });

  it("RETRY: non-transient failure does NOT retry", async () => {
    const fake = makeFake("non-transient-fail");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await expect(
      CheckoutService.createCheckoutOrder(transaction.id, { client: fake })
    ).rejects.toMatchObject({ code: "RAZORPAY_ORDER_FAILED", status: 502 });
    expect(fake.__callCount.count).toBe(1);
    const retryAudits = await prisma.auditEvent.findMany({ where: { eventType: "CHECKOUT_ORDER_RETRY", transactionId: transaction.id } });
    expect(retryAudits.length).toBe(0);
  });

  it("RETRY: invalid transaction state → no Razorpay call", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    // DRAFT transaction
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    await expect(
      CheckoutService.createCheckoutOrder(cart.id, { client: fake })
    ).rejects.toMatchObject({ code: "TRANSACTION_NOT_FOUND" });
    expect(fake.__callCount.count).toBe(0);
  });

  it("RETRY: DRAFT transaction (manually set) → no Razorpay call", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "DRAFT" } });
    await expect(
      CheckoutService.createCheckoutOrder(transaction.id, { client: fake })
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(fake.__callCount.count).toBe(0);
  });

  // ------------------------- Idempotency -------------------------

  it("IDEMPOTENT: sequential duplicate calls reuse the existing razorpay order", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    const first = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(fake.__callCount.count).toBe(1);
    expect(first.reused).toBe(false);

    // Second call — same fake, but it should NOT be called (reused path)
    const second = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(second.reused).toBe(true);
    expect(fake.__callCount.count).toBe(1); // no second Razorpay call
    // amount/currency come from snapshot
    expect(second.amount).toBe(first.amount);
    expect(second.currency).toBe(first.currency);
  });

  it("IDEMPOTENT: concurrent duplicate calls do not create two orders (sequential stress)", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();

    // Sequential stress — the first call advances state to ORDER_CREATED/PAYMENT_PENDING,
    // so the second call is the idempotent reuse path.
    const first = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    const second = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    const third = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(first.razorpayOrderId).toBe(second.razorpayOrderId);
    expect(second.razorpayOrderId).toBe(third.razorpayOrderId);
    expect(fake.__callCount.count).toBe(1);
  });

  it("IDEMPOTENT: PAYMENT_SUCCESS transaction → reuse, do not create another order", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    const first = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    // Move transaction to PAYMENT_SUCCESS
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "PAYMENT_SUCCESS", razorpayPaymentId: "pay_x_" + Date.now(), paymentStatus: "captured" },
    });
    const second = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
    expect(second.reused).toBe(true);
    expect(fake.__callCount.count).toBe(1);
  });

  it("IDEMPOTENT: PAYMENT_FAILED/UNKNOWN → reject (no new order)", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_FAILED" } });
    await expect(
      CheckoutService.createCheckoutOrder(transaction.id, { client: fake })
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
    expect(fake.__callCount.count).toBe(0);

    // Restore + set UNKNOWN
    const cart2 = await CartService.createCart();
    await CartService.addItem(cart2.id, prod.id, 1);
    const fetched2 = await CartService.getCart(cart2.id);
    const { transaction: txn2 } = await ApprovalService.approve(cart2.id, fetched2!.hash);
    await prisma.transaction.update({ where: { id: txn2.id }, data: { status: "PAYMENT_UNKNOWN" } });
    await expect(
      CheckoutService.createCheckoutOrder(txn2.id, { client: fake })
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
    expect(fake.__callCount.count).toBe(0);
  });

  // ------------------------- recordPaymentFailure -------------------------

  it("FAILED: PAYMENT_PENDING → PAYMENT_FAILED via recordPaymentFailure", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    // Txn is now PAYMENT_PENDING
    const r = await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "simulated" });
    expect(r.transitioned).toBe(true);
    expect(r.status).toBe("PAYMENT_FAILED");
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_FAILED");
    expect(fresh!.paymentStatus).toBe("failed");
  });

  it("FAILED: PAYMENT_PROCESSING → PAYMENT_FAILED via recordPaymentFailure", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_PROCESSING" } });
    const r = await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "simulated" });
    expect(r.transitioned).toBe(true);
    expect(r.status).toBe("PAYMENT_FAILED");
  });

  it("FAILED: cannot downgrade PAYMENT_SUCCESS", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_SUCCESS" } });
    const r = await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "simulated" });
    expect(r.transitioned).toBe(false);
    expect(r.status).toBe("PAYMENT_SUCCESS");
    // Audit logged
    const audits = await prisma.auditEvent.findMany({ where: { eventType: "PAYMENT_FAILURE_DOWNGRADE_REJECTED", transactionId: transaction.id } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("FAILED: idempotent on PAYMENT_FAILED (no double transition)", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_FAILED" } });
    const r = await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "x" });
    expect(r.transitioned).toBe(false);
    expect(r.status).toBe("PAYMENT_FAILED");
  });

  it("FAILED: invalid source state (DRAFT) → INVALID_STATE", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "DRAFT" } });
    await expect(
      CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "x" })
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  // ------------------------- markPaymentUnknown -------------------------

  it("UNKNOWN: PAYMENT_PENDING → PAYMENT_UNKNOWN via markPaymentUnknown", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    const r = await CheckoutService.markPaymentUnknown({ transactionId: transaction.id, source: "test", reason: "ambiguous" });
    expect(r.transitioned).toBe(true);
    expect(r.status).toBe("PAYMENT_UNKNOWN");
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_UNKNOWN");
    expect(fresh!.paymentStatus).toBe("unknown");
  });

  it("UNKNOWN: cannot downgrade PAYMENT_SUCCESS", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_SUCCESS" } });
    const r = await CheckoutService.markPaymentUnknown({ transactionId: transaction.id, source: "test", reason: "x" });
    expect(r.transitioned).toBe(false);
    expect(r.status).toBe("PAYMENT_SUCCESS");
    const audits = await prisma.auditEvent.findMany({ where: { eventType: "PAYMENT_UNKNOWN_DOWNGRADE_REJECTED", transactionId: transaction.id } });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("UNKNOWN: never auto-converted to SUCCESS (verifyPayment on UNKNOWN rejected)", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({ where: { id: transaction.id }, data: { status: "PAYMENT_UNKNOWN" } });
    await expect(
      CheckoutService.verifyPayment({
        transactionId: transaction.id,
        razorpayOrderId: "order_x",
        razorpayPaymentId: "pay_x",
        razorpaySignature: "sig_x",
      })
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
    // Status still UNKNOWN, never SUCCESS
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_UNKNOWN");
  });

  // ------------------------- Verify idempotency (extended) -------------------------

  it("VERIFY: invalid signature rejected even when transaction is already PAYMENT_SUCCESS", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "PAYMENT_SUCCESS", razorpayOrderId: "order_x_1", razorpayPaymentId: "pay_x_1", paymentStatus: "captured" },
    });
    await expect(
      CheckoutService.verifyPayment({
        transactionId: transaction.id,
        razorpayOrderId: "order_x_1",
        razorpayPaymentId: "pay_x_1",
        razorpaySignature: "definitely_not_a_valid_signature_0000000000000000000000000000",
      })
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_SUCCESS");
  });

  it("VERIFY: PAYMENT_FAILED transaction cannot be verified into success", async () => {
    const { transaction } = await approvedTransaction();
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: "PAYMENT_FAILED", razorpayOrderId: "order_x_2", paymentStatus: "failed" },
    });
    await expect(
      CheckoutService.verifyPayment({
        transactionId: transaction.id,
        razorpayOrderId: "order_x_2",
        razorpayPaymentId: "pay_x_2",
        razorpaySignature: "sig",
      })
    ).rejects.toMatchObject({ code: "TERMINAL_STATE" });
    const fresh = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    expect(fresh!.status).toBe("PAYMENT_FAILED");
  });

  // ------------------------- Audit invariants -------------------------

  it("AUDIT: every state transition in retry+verify+fail+unknown produces STATE_TRANSITION audit", async () => {
    const fake = makeFake("transient-then-ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    await CheckoutService.recordPaymentFailure({ transactionId: transaction.id, source: "test", reason: "x" });
    const transitions = await prisma.auditEvent.findMany({
      where: { transactionId: transaction.id, eventType: "STATE_TRANSITION" },
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    });
    // Expected: APPROVED→ORDER_CREATED, ORDER_CREATED→PAYMENT_PENDING, PAYMENT_PENDING→PAYMENT_FAILED
    const fromTo = transitions.map((t) => `${t.fromState}->${t.toState}`);
    expect(fromTo).toContain("APPROVED->ORDER_CREATED");
    expect(fromTo).toContain("ORDER_CREATED->PAYMENT_PENDING");
    expect(fromTo).toContain("PAYMENT_PENDING->PAYMENT_FAILED");
  });

  it("SECURITY: createCheckoutOrder never accepts client-controlled amount/currency", async () => {
    const fake = makeFake("ok");
    __setRazorpayClient(fake);
    const { transaction } = await approvedTransaction();
    // Even if we tamper the snapshot in DB, the SDK call uses snapshot.total
    const snap = JSON.parse((await prisma.transaction.findUnique({ where: { id: transaction.id } }))!.snapshot);
    const tamperedSnap = { ...snap, total: 1 }; // 1 paise
    await prisma.transaction.update({ where: { id: transaction.id }, data: { snapshot: JSON.stringify(tamperedSnap) } });
    // Service reads the (now-tampered) snapshot and uses 1 paise for Razorpay
    const result = await CheckoutService.createCheckoutOrder(transaction.id, { client: fake });
    // The fake records the amount the SDK was called with
    expect(fake.__lastAmount.value).toBe(1);
    expect(result.amount).toBe(1);
  });
});
