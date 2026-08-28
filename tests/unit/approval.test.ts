import { describe, it, expect, beforeAll } from "vitest";
import { ApprovalService } from "@/server/approval/service";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { prisma } from "@/lib/prisma";

describe("ApprovalService — idempotency, hash, state", () => {
  let prod: Awaited<ReturnType<typeof CatalogService.listProducts>>[0];

  beforeAll(async () => {
    prod = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 5)!;
  });

  it("valid approval creates APPROVED transaction", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const result = await ApprovalService.approve(cart.id, fetched!.hash);
    expect(result.transaction.status).toBe("APPROVED");
    expect(result.policy.approved).toBe(true);
    expect(result.isIdempotent).toBe(false);
    expect(result.transaction.cartHash).toBe(fetched!.hash);
  });

  it("stale hash rejected with 409", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    await expect(ApprovalService.approve(cart.id, "stale_hash_123")).rejects.toMatchObject({ code: "STALE_CART" });
  });

  it("empty cart policy fails", async () => {
    const cart = await CartService.createCart();
    await expect(ApprovalService.approve(cart.id, cart.hash)).rejects.toMatchObject({ code: "POLICY_FAILED" });
  });

  it("idempotent duplicate returns same transaction", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 2);
    const fetched = await CartService.getCart(cart.id);
    const first = await ApprovalService.approve(cart.id, fetched!.hash);
    const second = await ApprovalService.approve(cart.id, fetched!.hash);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(second.isIdempotent).toBe(true);
    expect(second.transaction.status).toBe("APPROVED");
  });

  it("concurrent duplicate results in single APPROVED (race)", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const [a, b] = await Promise.allSettled([
      ApprovalService.approve(cart.id, fetched!.hash),
      ApprovalService.approve(cart.id, fetched!.hash),
    ]);
    // At least one should be approved, the other either idempotent or same
    const fulfilled = [a, b].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof ApprovalService.approve>>>[];
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = fulfilled.map((f) => f.value.transaction.id);
    // Both should have same id if both succeeded
    if (ids.length === 2) expect(ids[0]).toBe(ids[1]);
    // Check DB only one transaction for this cart+hash
    const count = await prisma.transaction.count({ where: { cartId: cart.id, cartHash: fetched!.hash } });
    expect(count).toBe(1);
  });

  it("price injection via product price change after add causes policy fail (stale snapshot)", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    // Change product price to simulate stale
    const originalPrice = prod.price;
    await prisma.product.update({ where: { id: prod.id }, data: { price: originalPrice + 50000 } });
    const staleCart = await CartService.getCart(cart.id);
    // Policy should fail because prices_authoritative checks unitPrice vs current product price
    await expect(ApprovalService.approve(cart.id, staleCart!.hash)).rejects.toMatchObject({ code: "POLICY_FAILED" });
    // Restore
    await prisma.product.update({ where: { id: prod.id }, data: { price: originalPrice } });
  });

  it("APPROVED cannot transition to PAYMENT_SUCCESS but Phase 6 allows APPROVED→ORDER_CREATED", async () => {
    const { transition } = await import("@/server/transaction/stateMachine");
    expect(() => transition("APPROVED", "PAYMENT_SUCCESS")).toThrow(/Invalid transition/);
    expect(() => transition("APPROVED", "ORDER_CREATED")).not.toThrow();
    expect(() => transition("APPROVED", "ORDER_CREATING")).toThrow();
  });

  it("creates audit events for approval", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, prod.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const result = await ApprovalService.approve(cart.id, fetched!.hash);
    const audits = await prisma.auditEvent.findMany({ where: { transactionId: result.transaction.id } });
    expect(audits.length).toBeGreaterThanOrEqual(3); // DRAFT->CART_READY, CART_READY->APPROVAL_PENDING, APPROVAL_PENDING->APPROVED
    const last = audits.find((a) => a.toState === "APPROVED");
    expect(last).toBeDefined();
    expect(last!.verificationSource).toBe("user_explicit_approval");
    expect(last!.isSimulated).toBe(false);
  });
});
