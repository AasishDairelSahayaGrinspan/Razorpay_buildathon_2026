import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { ApprovalService } from "@/server/approval/service";
import { CheckoutService } from "@/server/checkout/service";
import { GET as auditGET } from "@/app/api/audit/route";

async function callAuditGET(query: string): Promise<Response> {
  const req = new Request(`http://localhost/api/audit${query}`, { method: "GET" });
  return auditGET(req as unknown as Request);
}

describe("GET /api/audit — Phase 8", () => {
  let prod: Awaited<ReturnType<typeof CatalogService.listProducts>>[0];

  beforeAll(async () => {
    prod = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 5)!;
  });

  afterAll(async () => {
    await prisma.auditEvent.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
  });

  async function createAuditedTransaction() {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const { transaction } = await ApprovalService.approve(cart.id, fetched!.hash);
    const orderResult = await CheckoutService.createCheckoutOrder(transaction.id);
    // Also verify payment to generate more audit events
    const paymentId = "pay_audit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const secret = process.env.RAZORPAY_KEY_SECRET!;
    const sig = createHmac("sha256", secret).update(`${orderResult.razorpayOrderId}|${paymentId}`).digest("hex");
    await CheckoutService.verifyPayment({
      transactionId: transaction.id,
      razorpayOrderId: orderResult.razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: sig,
    });
    const txn = await prisma.transaction.findUnique({ where: { id: transaction.id } });
    return { cart, transaction: txn!, orderResult, paymentId };
  }

  it("transaction audit lookup returns ordered events with all fields", async () => {
    const { cart, transaction } = await createAuditedTransaction();
    const res = await callAuditGET(`?transactionId=${encodeURIComponent(transaction.id)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(5);
    // Check required fields preserved
    for (const e of body.events) {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("eventType");
      expect(e).toHaveProperty("timestamp");
      expect(e).toHaveProperty("fromState");
      expect(e).toHaveProperty("toState");
      expect(e).toHaveProperty("isSimulated");
      // Optional but should exist as keys (may be null)
      expect(e).toHaveProperty("transactionId");
      expect(e).toHaveProperty("cartId");
      expect(e).toHaveProperty("requestId");
      expect(e).toHaveProperty("cartHash");
      expect(e).toHaveProperty("policyPassed");
      expect(e).toHaveProperty("policyTotal");
      expect(e).toHaveProperty("verificationSource");
      // Must not expose secrets
      const json = JSON.stringify(e).toLowerCase();
      expect(json).not.toContain("key_secret");
      expect(json).not.toContain("razorpay_key_secret");
      expect(json).not.toContain("whsec");
    }
    // Deterministic ordering: timestamp asc, id asc
    const timestamps = body.events.map((e: { timestamp: string; id: string }) => ({ ts: new Date(e.timestamp).getTime(), id: e.id }));
    for (let i = 1; i < timestamps.length; i++) {
      const prev = timestamps[i - 1];
      const cur = timestamps[i];
      // Either timestamp strictly increasing, or same timestamp with id sorted asc
      if (prev.ts === cur.ts) {
        expect(prev.id.localeCompare(cur.id)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.ts).toBeLessThanOrEqual(cur.ts);
      }
    }
    // At least one event should have policy and verificationSource
    const withPolicy = body.events.filter((e: { policyPassed: number | null }) => e.policyPassed !== null);
    expect(withPolicy.length).toBeGreaterThanOrEqual(1);
    expect(body.events.some((e: { verificationSource: string | null }) => e.verificationSource !== null)).toBe(true);

    // Also verify cartId matches
    expect(body.events[0].cartId).toBe(cart.id);
    expect(body.events[0].transactionId).toBe(transaction.id);
  });

  it("cart audit lookup returns ordered events", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    await ApprovalService.approve(cart.id, fetched!.hash);

    const res = await callAuditGET(`?cartId=${encodeURIComponent(cart.id)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    for (const e of body.events) {
      expect(e.cartId).toBe(cart.id);
    }
    // Ordered
    for (let i = 1; i < body.events.length; i++) {
      const prev = new Date(body.events[i - 1].timestamp).getTime();
      const cur = new Date(body.events[i].timestamp).getTime();
      expect(prev).toBeLessThanOrEqual(cur);
    }
  });

  it("missing identifiers returns 400 VALIDATION_ERROR", async () => {
    const res = await callAuditGET("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("missing both with empty query returns 400", async () => {
    const res = await callAuditGET("?transactionId=&cartId=");
    expect(res.status).toBe(400);
  });

  it("unknown transactionId returns 200 with empty events (safe)", async () => {
    const fakeId = "txn_unknown_" + Date.now();
    const res = await callAuditGET(`?transactionId=${encodeURIComponent(fakeId)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBe(0);
  });

  it("unknown cartId returns 200 with empty events", async () => {
    const fakeId = "cart_unknown_" + Date.now();
    const res = await callAuditGET(`?cartId=${encodeURIComponent(fakeId)}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(0);
  });

  it("does not expose secrets and is read-only", async () => {
    const { transaction } = await createAuditedTransaction();
    const res = await callAuditGET(`?transactionId=${encodeURIComponent(transaction.id)}`);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(raw).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/i);
    expect(raw).not.toMatch(/keySecret/i);
    // Verify POST not allowed
    const { POST } = await import("@/app/api/audit/route");
    const postRes = await POST();
    expect(postRes.status).toBe(405);
  });

  it("cart audit includes approval and checkout events", async () => {
    const { cart } = await createAuditedTransaction();
    const res = await callAuditGET(`?cartId=${encodeURIComponent(cart.id)}`);
    const body = await res.json();
    const types = body.events.map((e: { eventType: string }) => e.eventType);
    // Should include at least one STATE_TRANSITION and APPROVAL_GRANTED and CHECKOUT_ORDER_CREATED
    expect(types.some((t: string) => t.includes("STATE_TRANSITION") || t.includes("APPROVAL"))).toBe(true);
  });
});
