"use client";

import * as React from "react";

export type CartItem = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  product: { id: string; name: string; price: number; currency: string; inventory: number; active: boolean };
};

export type Cart = {
  id: string;
  merchantId: string;
  status: string;
  currency: string;
  items: CartItem[];
  totals: { subtotal: number; total: number; currency: string; itemCount: number };
  hash: string;
};

const STORAGE_KEY = "cartId";

export function useCart() {
  const [cart, setCart] = React.useState<Cart | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchCart = React.useCallback(async (cartId: string) => {
    const res = await fetch(`/api/cart/${cartId}`);
    if (!res.ok) throw new Error((await res.json()).error?.message ?? "Failed to fetch cart");
    const body = await res.json();
    return body.cart as Cart;
  }, []);

  const ensureCart = React.useCallback(async (): Promise<string> => {
    const cartId = localStorage.getItem(STORAGE_KEY);
    if (cartId) {
      try {
        const c = await fetchCart(cartId);
        setCart(c);
        return c.id;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    // Create new
    const res = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) throw new Error("Failed to create cart");
    const body = await res.json();
    const newCart = body.cart as Cart;
    localStorage.setItem(STORAGE_KEY, newCart.id);
    setCart(newCart);
    return newCart.id;
  }, [fetchCart]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    ensureCart().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ensureCart]);

  const refresh = React.useCallback(async () => {
    const cartId = localStorage.getItem(STORAGE_KEY);
    if (!cartId) return;
    try {
      const c = await fetchCart(cartId);
      setCart(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchCart]);

  const addItem = async (productId: string, quantity: number) => {
    setLoading(true);
    setError(null);
    try {
      const cartId = await ensureCart();
      const res = await fetch(`/api/cart/${cartId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Add failed");
      setCart(body.cart);
      return body.cart as Cart;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const updateQuantity = async (itemId: string, quantity: number) => {
    setLoading(true);
    setError(null);
    try {
      const cartId = localStorage.getItem(STORAGE_KEY);
      if (!cartId) throw new Error("No cart");
      const res = await fetch(`/api/cart/${cartId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Update failed");
      setCart(body.cart);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const removeItem = async (itemId: string) => {
    setLoading(true);
    setError(null);
    try {
      const cartId = localStorage.getItem(STORAGE_KEY);
      if (!cartId) throw new Error("No cart");
      const res = await fetch(`/api/cart/${cartId}/items/${itemId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Remove failed");
      setCart(body.cart);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const clearCart = async () => {
    setLoading(true);
    setError(null);
    try {
      const cartId = localStorage.getItem(STORAGE_KEY);
      if (!cartId) return;
      const res = await fetch(`/api/cart/${cartId}/clear`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? "Clear failed");
      setCart(body.cart);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return { cart, loading, error, addItem, updateQuantity, removeItem, clearCart, refresh, setError };
}
