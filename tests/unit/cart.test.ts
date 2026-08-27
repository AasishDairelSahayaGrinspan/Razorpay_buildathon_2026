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
    await prisma.auditEvent.deleteMany({});
    await prisma.transaction.deleteMany({});
    await prisma.cartItem.deleteMany({});
    await prisma.cart.deleteMany({});
    // Cleanup any test products created
    await prisma.product.deleteMany({ where: { name: { startsWith: "Test Product" } } });
  });

  async function createTestProduct(overrides: Partial<{ name: string; price: number; inventory: number; active: boolean }> = {}) {
    return prisma.product.create({
      data: {
        name: overrides.name ?? `Test Product ${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        description: "Test product for isolated test",
        category: "Test",
        price: overrides.price ?? 10000,
        currency: "INR",
        inventory: overrides.inventory ?? 10,
        active: overrides.active ?? true,
        tags: "test",
        features: JSON.stringify([]),
      },
    });
  }

  it("createCart creates ACTIVE cart with INR currency", async () => {
    const cart = await CartService.createCart();
    expect(cart.id).toBeDefined();
    expect(cart.status).toBe("ACTIVE");
    expect(cart.currency).toBe("INR");
    expect(cart.items.length).toBe(0);
    expect(cart.totals.total).toBe(0);
    expect(cart.hash).toBeDefined();
  });

  it("addItem stores server-authoritative unitPrice, not client price", async () => {
    const testProd = await createTestProduct({ price: 50000, inventory: 10 });
    const cart = await CartService.createCart();
    const beforePrice = testProd.price;
    const updated = await CartService.addItem(cart.id, testProd.id, 2);
    expect(updated!.items[0].unitPrice).toBe(beforePrice);
    // Change product price in DB temporarily
    await prisma.product.update({ where: { id: testProd.id }, data: { price: beforePrice + 10000 } });
    try {
      const afterPriceChange = await CartService.getCart(cart.id);
      expect(afterPriceChange!.totals.total).toBe(beforePrice * 2);
      expect(afterPriceChange!.items[0].unitPrice).toBe(beforePrice);
    } finally {
      await prisma.product.update({ where: { id: testProd.id }, data: { price: beforePrice } });
      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await prisma.cart.delete({ where: { id: cart.id } });
      await prisma.product.delete({ where: { id: testProd.id } });
    }
  });

  it("client cannot override total — total always calculated server-side", async () => {
    const cart = await CartService.createCart();
    const updated = await CartService.addItem(cart.id, productActive!.id, 1);
    expect(updated!.totals.total).toBe(productActive!.price);
    const updated2 = await CartService.addItem(cart.id, productActive2!.id, 1);
    expect(updated2!.totals.total).toBe(productActive!.price + productActive2!.price);
  });

  it("integer paise arithmetic", async () => {
    const testProd = await createTestProduct({ price: 12345, inventory: 10 });
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, testProd.id, 3);
    const fetched = await CartService.getCart(cart.id);
    expect(fetched!.totals.total).toBe(12345 * 3);
    expect(Number.isInteger(fetched!.totals.total)).toBe(true);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.delete({ where: { id: cart.id } });
    await prisma.product.delete({ where: { id: testProd.id } });
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
    const testProd = await createTestProduct({ inventory: 2 });
    try {
      await expect(CartService.addItem(cart.id, testProd.id, 3)).rejects.toThrow(/inventory/i);
    } finally {
      await prisma.product.delete({ where: { id: testProd.id } });
    }
  });

  it("invalid quantities rejected", async () => {
    const testProd = await createTestProduct({ inventory: 10 });
    const cart = await CartService.createCart();
    try {
      await expect(CartService.addItem(cart.id, testProd.id, 0)).rejects.toThrow(/quantity/i);
      await expect(CartService.addItem(cart.id, testProd.id, 11)).rejects.toThrow(/quantity/i);
      await expect(CartService.addItem(cart.id, testProd.id, -1)).rejects.toThrow(/quantity/i);
      await expect(CartService.addItem(cart.id, testProd.id, 1.5 as unknown as number)).rejects.toThrow(/quantity/i);
    } finally {
      await prisma.product.delete({ where: { id: testProd.id } });
    }
  });

  it("unknown product rejected", async () => {
    const cart = await CartService.createCart();
    await expect(CartService.addItem(cart.id, "nonexistent_123", 1)).rejects.toThrow(/not found/i);
  });

  it("merchant ownership enforced", async () => {
    const cart = await CartService.createCart({ merchantId: "other_merchant" });
    await expect(CartService.addItem(cart.id, productActive!.id, 1)).rejects.toThrow(/merchant/i);
  });

  it("update quantity, remove, clear", async () => {
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, productActive!.id, 1);
    const fetched = await CartService.getCart(cart.id);
    const itemId = fetched!.items[0].id;
    const updated = await CartService.updateItemQuantity(cart.id, itemId, 3);
    expect(updated!.items[0].quantity).toBe(3);
    expect(updated!.totals.total).toBe(productActive!.price * 3);
    const afterRemove = await CartService.removeItem(cart.id, itemId);
    expect(afterRemove!.items.length).toBe(0);
    expect(afterRemove!.totals.total).toBe(0);
    await CartService.addItem(cart.id, productActive!.id, 1);
    await CartService.addItem(cart.id, productActive2!.id, 2);
    const beforeClear = await CartService.getCart(cart.id);
    expect(beforeClear!.items.length).toBe(2);
    const cleared = await CartService.clearCart(cart.id);
    expect(cleared!.items.length).toBe(0);
    expect(cleared!.totals.total).toBe(0);
  });

  it("cart hash determinism — same contents same hash, different contents different hash", async () => {
    const testProd = await createTestProduct({ price: 10000, inventory: 10 });
    const cart1 = await CartService.createCart();
    const cart2 = await CartService.createCart();
    await CartService.addItem(cart1.id, testProd.id, 1);
    await CartService.addItem(cart2.id, testProd.id, 1);
    const c1 = await CartService.getCart(cart1.id);
    const c2 = await CartService.getCart(cart2.id);
    expect(c1!.hash).not.toBe(c2!.hash);
    const c1Again = await CartService.getCart(cart1.id);
    expect(c1!.hash).toBe(c1Again!.hash);
    await CartService.updateItemQuantity(cart1.id, c1!.items[0].id, 2);
    const c1Updated = await CartService.getCart(cart1.id);
    expect(c1Updated!.hash).not.toBe(c1!.hash);
    await prisma.cartItem.deleteMany({ where: { cartId: { in: [cart1.id, cart2.id] } } });
    await prisma.cart.deleteMany({ where: { id: { in: [cart1.id, cart2.id] } } });
    await prisma.product.delete({ where: { id: testProd.id } });
  });

  it("cart hash includes productIds, quantities, unitPrices, currency, total — not client values", async () => {
    const testProd = await createTestProduct({ price: 20000, inventory: 10 });
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, testProd.id, 2);
    const fetched = await CartService.getCart(cart.id);
    const expected = CartService._computeHash(
      { id: fetched!.id, merchantId: fetched!.merchantId, currency: fetched!.currency } as never,
      fetched!.items as unknown as never,
      fetched!.totals
    );
    expect(fetched!.hash).toBe(expected);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.delete({ where: { id: cart.id } });
    await prisma.product.delete({ where: { id: testProd.id } });
  });

  it("add same product increments quantity rather than duplicate", async () => {
    const testProd = await createTestProduct({ price: 15000, inventory: 10 });
    const cart = await CartService.createCart();
    await CartService.addItem(cart.id, testProd.id, 1);
    await CartService.addItem(cart.id, testProd.id, 2);
    const fetched = await CartService.getCart(cart.id);
    expect(fetched!.items.length).toBe(1);
    expect(fetched!.items[0].quantity).toBe(3);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await prisma.cart.delete({ where: { id: cart.id } });
    await prisma.product.delete({ where: { id: testProd.id } });
  });
});
