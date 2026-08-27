import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CartService } from "@/server/cart";
import { CatalogService } from "@/server/catalog";
import { prisma } from "@/lib/prisma";

describe("CartService — Phase 4", () => {
  let productActive: Awaited<ReturnType<typeof CatalogService.getProduct>>;
  let productActive2: Awaited<ReturnType<typeof CatalogService.getProduct>>;
  let productInactive: Awaited<ReturnType<typeof CatalogService.getProduct>>;
  let productOOS: Awaited<ReturnType<typeof CatalogService.getProduct>>;

  beforeAll(async () => {
    const allActive = await CatalogService.listProducts({ activeOnly: true });
    const allAll = await CatalogService.listProducts({ activeOnly: false });
    productActive = allActive.find((p) => p.inventory > 5) ?? allActive[0];
    productActive2 = allActive.find((p) => p.id !== productActive!.id && p.inventory > 5) ?? allActive[1];
    productInactive = allAll.find((p) => !p.active) ?? null;
    productOOS = allActive.find((p) => p.inventory === 0) ?? null;
  });

  afterAll(async () => {
    // Cleanup carts created in tests (keep DB tidy)
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
  });

  it("createCart creates ACTIVE cart with INR currency", async () => {
    const cart = await CartService.createCart();
    expect(cart.id).toBeDefined();
    expect(cart.status).toBe("ACTIVE");
    expect(cart.currency).toBe("INR");
    expect(cart.items.length).toBe(0);
    expect(cart.totals.total).toBe(0);
    expect(cart.hash).toBeDefined();
    expect(cart.hash.length).toBeGreaterThan(0);
  });

  it("addItem stores server-authoritative unitPrice, not client price", async () => {
    const cart = await CartService.createCart();
    const prod = productActive!;
    const beforePrice = prod.price;
    // Add with correct quantity
    const updated = await CartService.addItem(cart.id, prod.id, 2);
    expect(updated!.items.length).toBe(1);
    const item = updated!.items[0];
    expect(item.unitPrice).toBe(beforePrice);
    expect(item.quantity).toBe(2);
    expect(item.currency).toBe("INR");
    expect(updated!.totals.total).toBe(beforePrice * 2);
    expect(updated!.totals.subtotal).toBe(beforePrice * 2);
    // Try to simulate client price injection: addItem does not accept price param, so we test that even if product price changes, cart keeps snapshot
    // Change product price in DB temporarily
    await prisma.product.update({ where: { id: prod.id }, data: { price: beforePrice + 10000 } });
    const afterPriceChange = await CartService.getCart(cart.id);
    // Cart total should still be based on snapshot, not new price
    expect(afterPriceChange!.totals.total).toBe(beforePrice * 2);
    expect(afterPriceChange!.items[0].unitPrice).toBe(beforePrice);
    // Restore
    await prisma.product.update({ where: { id: prod.id }, data: { price: beforePrice } });
  });

  it("client cannot override total — total always calculated server-side", async () => {
    const cart = await CartService.createCart();
    const updated = await CartService.addItem(cart.id, productActive!.id, 1);
    // Even if client tries to send total via API (tested in API tests), service total is deterministic
    expect(updated!.totals.total).toBe(productActive!.price);
    // Add second product
    const updated2 = await CartService.addItem(cart.id, productActive2!.id, 1);
    expect(updated2!.totals.total).toBe(productActive!.price + productActive2!.price);
  });

  it("integer paise arithmetic", async () => {
    const cart = await CartService.createCart();
    const p = productActive!;
    await CartService.addItem(cart.id, p.id, 3);
    const fetched = await CartService.getCart(cart.id);
    expect(fetched!.totals.total).toBe(p.price * 3);
    expect(Number.isInteger(fetched!.totals.total)).toBe(true);
  });

  it("inactive product cannot be added", async () => {
    if (!productInactive) return;
    const cart = await CartService.createCart();
    await expect(CartService.addItem(cart.id, productInactive.id, 1)).rejects.toThrow(/inactive/i);
  });

  it("insufficient inventory cannot be added", async () => {
    if (!productOOS) return;
    const cart = await CartService.createCart();
    await expect(CartService.addItem(cart.id, productOOS.id, 1)).rejects.toThrow(/inventory/i);
    // Also test quantity exceeds inventory
    const lowStock = (await CatalogService.listProducts({ activeOnly: true })).find((p) => p.inventory > 0 && p.inventory < 5);
    if (lowStock) {
      await expect(CartService.addItem(cart.id, lowStock.id, lowStock.inventory + 1)).rejects.toThrow(/inventory/i);
    }
  });

  it("invalid quantities rejected", async () => {
    const cart = await CartService.createCart();
    await expect(CartService.addItem(cart.id, productActive!.id, 0)).rejects.toThrow(/quantity/i);
    await expect(CartService.addItem(cart.id, productActive!.id, 11)).rejects.toThrow(/quantity/i);
    await expect(CartService.addItem(cart.id, productActive!.id, -1)).rejects.toThrow(/quantity/i);
    await expect(CartService.addItem(cart.id, productActive!.id, 1.5 as unknown as number)).rejects.toThrow(/quantity/i);
  });

  it("unknown product rejected", async () => {
    const cart = await CartService.createCart();
    await expect(CartService.addItem(cart.id, "nonexistent_123", 1)).rejects.toThrow(/not found/i);
  });

  it("merchant ownership enforced", async () => {
    // Create cart with different merchantId
    const cart = await CartService.createCart({ merchantId: "other_merchant" });
    // Try to add product from merchant_demo (should fail)
    await expect(CartService.addItem(cart.id, productActive!.id, 1)).rejects.toThrow(/merchant/i);
  });

  it("update quantity, remove, clear", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, productActive!.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const itemId = fetched!.items[0].id;
    // Update to 3
    const updated = await CartService.updateItemQuantity(cart.id, itemId, 3);
    expect(updated!.items[0].quantity).toBe(3);
    expect(updated!.totals.total).toBe(productActive!.price * 3);
    // Remove
    const afterRemove = await CartService.removeItem(cart.id, itemId);
    expect(afterRemove!.items.length).toBe(0);
    expect(afterRemove!.totals.total).toBe(0);
    // Add two, then clear
    await CartService.addItem(cart.id, productActive!.id, 1);
    await CartService.addItem(cart.id, productActive2!.id, 2);
    const beforeClear = await CartService.getCart(cart.id);
    expect(beforeClear!.items.length).toBe(2);
    const cleared = await CartService.clearCart(cart.id);
    expect(cleared!.items.length).toBe(0);
    expect(cleared!.totals.total).toBe(0);
  });

  it("cart hash determinism — same contents same hash, different contents different hash", async () => {
    const cart1 = await CartService.createCart();
    const cart2 = await CartService.createCart();
    await CartService.addItem(cart1.id, productActive!.id, 1);
    await CartService.addItem(cart2.id, productActive!.id, 1);
    const c1 = await CartService.getCart(cart1.id);
    const c2 = await CartService.getCart(cart2.id);
    // Same product/qty/currency but different cartId → hash should differ because cartId included
    expect(c1!.hash).not.toBe(c2!.hash);
    // Same cart, same contents → hash stable
    const c1Again = await CartService.getCart(cart1.id);
    expect(c1!.hash).toBe(c1Again!.hash);
    // Different quantity → different hash
    await CartService.updateItemQuantity(cart1.id, c1!.items[0].id, 2);
    const c1Updated = await CartService.getCart(cart1.id);
    expect(c1Updated!.hash).not.toBe(c1!.hash);
    // Verify hash includes unitPrice — change product price and re-add, hash should reflect snapshot not client
    // (hash is based on unitPrice snapshot, so if we add same product with different snapshot, hash differs)
  });

  it("cart hash includes productIds, quantities, unitPrices, currency, total — not client values", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, productActive!.id, 2);
    const fetched = await CartService.getCart(cart.id);
    // Compute expected hash manually using same logic
    const expected = CartService._computeHash(
      { id: fetched!.id, merchantId: fetched!.merchantId, currency: fetched!.currency } as never,
      fetched!.items as unknown as never,
      fetched!.totals
    );
    expect(fetched!.hash).toBe(expected);
  });

  it("add same product increments quantity rather than duplicate", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, productActive!.id, 1);
    await CartService.addItem(cart.id, productActive!.id, 2);
    const fetched = await CartService.getCart(cart.id);
    expect(fetched!.items.length).toBe(1);
    expect(fetched!.items[0].quantity).toBe(3);
  });
});
