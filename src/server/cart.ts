import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { CatalogService } from "./catalog";
import type { Cart, CartItem } from "@/generated/prisma/client";

/**
 * CartService — server-authoritative
 * UI → API → CartService → CatalogService → Prisma
 * Client may submit only productId + quantity; price/total never from client.
 */

const MAX_QTY_PER_ITEM = 10;
const MAX_ITEMS_PER_CART = 20;

export type CartWithItems = Cart & {
  items: (CartItem & { product: { id: string; name: string; price: number; currency: string; inventory: number; active: boolean } })[];
};

export type CartTotals = {
  subtotal: number; // paise sum of unitPrice*qty
  total: number; // same for Phase 4 (no tax/shipping)
  currency: string;
  itemCount: number;
};

export type CartSnapshot = {
  cartId: string;
  merchantId: string;
  currency: string;
  items: { productId: string; quantity: number; unitPrice: number; currency: string }[];
  totals: CartTotals;
  hash: string;
};

function computeHash(cart: Cart, items: CartItem[], totals: CartTotals): string {
  // Canonical: sorted productIds, quantities, unitPrices, currency, total
  const canonical = {
    cartId: cart.id,
    merchantId: cart.merchantId,
    currency: cart.currency,
    items: items
      .map((it) => ({ productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice, currency: it.currency }))
      .sort((a, b) => a.productId.localeCompare(b.productId)),
    totals,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

function calculateTotals(items: CartItem[], currency: string): CartTotals {
  let subtotal = 0;
  for (const it of items) {
    // Integer arithmetic only
    subtotal += it.unitPrice * it.quantity;
  }
  return { subtotal, total: subtotal, currency, itemCount: items.length };
}

export const CartService = {
  async createCart(opts?: { merchantId?: string; currency?: string }): Promise<CartWithItems & { totals: CartTotals; hash: string }> {
    const cart = await prisma.cart.create({
      data: {
        merchantId: opts?.merchantId ?? "merchant_demo",
        currency: opts?.currency ?? "INR",
        status: "ACTIVE",
      },
    });
    const withItems = await this.getCart(cart.id);
    if (!withItems) throw new Error("Failed to create cart");
    return withItems;
  },

  async getCart(cartId: string): Promise<(CartWithItems & { totals: CartTotals; hash: string }) | null> {
    if (!cartId || typeof cartId !== "string") return null;
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true, price: true, currency: true, inventory: true, active: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return null;
    const totals = calculateTotals(cart.items, cart.currency);
    const hash = computeHash(cart, cart.items, totals);
    return { ...cart, totals, hash } as CartWithItems & { totals: CartTotals; hash: string };
  },

  async addItem(cartId: string, productId: string, quantity: number) {
    // Validation
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      throw Object.assign(new Error(`Quantity must be integer 1-${MAX_QTY_PER_ITEM}`), { code: "INVALID_QUANTITY" });
    }
    const cart = await prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw Object.assign(new Error("Cart not found"), { code: "CART_NOT_FOUND" });
    if (cart.status !== "ACTIVE") throw Object.assign(new Error("Cart not active"), { code: "CART_NOT_ACTIVE" });

    const product = await CatalogService.getProduct(productId);
    if (!product) throw Object.assign(new Error("Product not found"), { code: "PRODUCT_NOT_FOUND" });
    if (!product.active) throw Object.assign(new Error("Product inactive"), { code: "PRODUCT_INACTIVE" });
    if (product.merchantId !== cart.merchantId) throw Object.assign(new Error("Merchant mismatch"), { code: "MERCHANT_MISMATCH" });
    if (product.inventory < quantity) throw Object.assign(new Error("Insufficient inventory"), { code: "INSUFFICIENT_INVENTORY" });

    // Check existing item
    const existing = await prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId } },
    });

    if (existing) {
      const newQty = existing.quantity + quantity;
      if (newQty > MAX_QTY_PER_ITEM) throw Object.assign(new Error(`Quantity exceeds max ${MAX_QTY_PER_ITEM}`), { code: "INVALID_QUANTITY" });
      if (product.inventory < newQty) throw Object.assign(new Error("Insufficient inventory for combined quantity"), { code: "INSUFFICIENT_INVENTORY" });
      // Update with server price snapshot (re-read product price)
      await prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: newQty, unitPrice: product.price, currency: product.currency },
      });
      return this.getCart(cartId);
    }

    // Check cart size limit
    const count = await prisma.cartItem.count({ where: { cartId } });
    if (count >= MAX_ITEMS_PER_CART) throw Object.assign(new Error("Cart full"), { code: "CART_FULL" });

    await prisma.cartItem.create({
      data: {
        cartId,
        productId,
        quantity,
        unitPrice: product.price, // server-authoritative
        currency: product.currency,
      },
    });
    return this.getCart(cartId);
  },

  async updateItemQuantity(cartId: string, itemId: string, quantity: number) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY_PER_ITEM) {
      throw Object.assign(new Error(`Quantity must be integer 1-${MAX_QTY_PER_ITEM}`), { code: "INVALID_QUANTITY" });
    }
    const cart = await prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw Object.assign(new Error("Cart not found"), { code: "CART_NOT_FOUND" });
    if (cart.status !== "ACTIVE") throw Object.assign(new Error("Cart not active"), { code: "CART_NOT_ACTIVE" });

    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cartId) throw Object.assign(new Error("Item not found in cart"), { code: "ITEM_NOT_FOUND" });

    const product = await CatalogService.getProduct(item.productId);
    if (!product) throw Object.assign(new Error("Product not found"), { code: "PRODUCT_NOT_FOUND" });
    if (!product.active) throw Object.assign(new Error("Product inactive"), { code: "PRODUCT_INACTIVE" });
    if (product.inventory < quantity) throw Object.assign(new Error("Insufficient inventory"), { code: "INSUFFICIENT_INVENTORY" });

    await prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity, unitPrice: product.price, currency: product.currency },
    });
    return this.getCart(cartId);
  },

  async removeItem(cartId: string, itemId: string) {
    const cart = await prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw Object.assign(new Error("Cart not found"), { code: "CART_NOT_FOUND" });
    const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cartId) throw Object.assign(new Error("Item not found"), { code: "ITEM_NOT_FOUND" });
    await prisma.cartItem.delete({ where: { id: itemId } });
    return this.getCart(cartId);
  },

  async clearCart(cartId: string) {
    const cart = await prisma.cart.findUnique({ where: { id: cartId } });
    if (!cart) throw Object.assign(new Error("Cart not found"), { code: "CART_NOT_FOUND" });
    await prisma.cartItem.deleteMany({ where: { cartId } });
    return this.getCart(cartId);
  },

  // Expose for tests
  _computeHash: computeHash,
  _calculateTotals: calculateTotals,
};
