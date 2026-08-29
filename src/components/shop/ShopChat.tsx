"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/ProductCard";
import type { ApiProduct } from "@/server/catalog";
import { useCart } from "@/hooks/useCart";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  recommendations?: { productId: string; reason: string; confidence: string }[];
  upsell?: { productId: string; reason: string; confidence: string }[];
  crossSell?: { productId: string; reason: string; confidence: string }[];
  meta?: { requestId: string; toolsUsed: string[]; latencyMs: number; llm?: string };
};

async function fetchProduct(id: string): Promise<ApiProduct | null> {
  try {
    const res = await fetch(`/api/products/${id}`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.product as ApiProduct;
  } catch {
    return null;
  }
}

function useProducts(ids: string[]) {
  const [map, setMap] = React.useState<Record<string, ApiProduct>>({});
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (ids.length === 0) return;
    const missing = ids.filter((id) => !map[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(missing.map((id) => fetchProduct(id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, ApiProduct> = {};
      results.forEach((p, i) => {
        if (p) next[missing[i]] = p;
      });
      setMap((prev) => ({ ...prev, ...next }));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);
  return { map, loading };
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && (window as unknown as { Razorpay?: unknown }).Razorpay) {
      resolve();
      return;
    }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay checkout")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout"));
    document.body.appendChild(script);
  });
}

function CartPanel({
  cart,
  loading,
  error,
  updateQuantity,
  removeItem,
  clearCart,
}: {
  cart: ReturnType<typeof useCart>["cart"];
  loading: boolean;
  error: string | null;
  updateQuantity: (itemId: string, qty: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
}) {
  const [approving, setApproving] = React.useState(false);
  const [approvalError, setApprovalError] = React.useState<string | null>(null);
  const [approval, setApproval] = React.useState<{ id: string; status: string; cartHash: string; total: number; currency: string } | null>(null);
  const [policy, setPolicy] = React.useState<{ passed: number; total: number; checks: { id: string; name: string; passed: boolean; message: string }[] } | null>(null);
  const [checkoutOrder, setCheckoutOrder] = React.useState<{ transactionId: string; razorpayOrderId: string; amount: number; currency: string; keyId: string } | null>(null);
  const [checkoutLoading, setCheckoutLoading] = React.useState(false);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  const [paymentSuccess, setPaymentSuccess] = React.useState<{ transactionId: string; status: string; razorpayPaymentId: string } | null>(null);
  const [paymentStatus, setPaymentStatus] = React.useState<string | null>(null);

  const handleApprove = async () => {
    if (!cart) return;
    // Do not allow empty or stale hash — fetch fresh server cart first
    setApproving(true);
    setApprovalError(null);
    try {
      // Always use latest server-backed cart.hash, not potentially stale prop
      const freshRes = await fetch(`/api/cart/${cart.id}`);
      if (!freshRes.ok) throw new Error("Failed to load cart");
      const freshBody = await freshRes.json();
      const freshCart = freshBody.cart as { id: string; hash: string; items: unknown[] };
      if (!freshCart?.hash || !freshCart.items || freshCart.items.length === 0) {
        throw new Error("Cart is empty — add items and wait for cart to update before approving");
      }
      if (!freshCart.hash) throw new Error("Cart hash not ready — wait for cart to update");
      const res = await fetch("/api/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cartId: freshCart.id, cartHash: freshCart.hash }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = body?.error?.message ?? "Approval failed";
        if (body?.policy) setPolicy(body.policy);
        throw new Error(body?.error?.code === "STALE_CART" ? `Stale cart: ${msg}` : body?.error?.code === "POLICY_FAILED" ? `Policy failed: ${body.policy?.checks?.filter((c: { passed: boolean }) => !c.passed).map((c: { name: string }) => c.name).join(", ")}` : msg);
      }
      setApproval(body.transaction);
      setPolicy(body.policy);
      setCheckoutOrder(null);
      setCheckoutError(null);
      setPaymentSuccess(null);
      setPaymentStatus(null);
    } catch (e) {
      setApprovalError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  };

  const handleCheckout = async () => {
    if (!approval) return;
    setCheckoutLoading(true);
    setCheckoutError(null);
    setPaymentSuccess(null);
    setPaymentStatus(null);
    try {
      const res = await fetch("/api/checkout/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: approval.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error?.message ?? "Checkout order failed");
      }
      // body contains transactionId, razorpayOrderId, amount, currency, keyId — amount/orderId from server only
      const orderData = body as { transactionId: string; razorpayOrderId: string; amount: number; currency: string; keyId: string };
      setCheckoutOrder(orderData);

      await loadRazorpayScript();
      // Open Razorpay TEST Checkout — amount/orderId must come from server response, never client override
      const options = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        order_id: orderData.razorpayOrderId,
        name: "Nimbus Commerce",
        description: "Test Payment — do not use real money",
        notes: { transactionId: orderData.transactionId },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          setVerifying(true);
          setCheckoutError(null);
          try {
            const verifyRes = await fetch("/api/checkout/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transactionId: orderData.transactionId,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const verifyBody = await verifyRes.json();
            if (!verifyRes.ok) {
              throw new Error(verifyBody?.error?.message ?? "Payment verification failed");
            }
            // Only after successful SERVER verification show PAYMENT_SUCCESS
            setPaymentSuccess(verifyBody);
            setPaymentStatus(verifyBody.status);
          } catch (e) {
            setCheckoutError(e instanceof Error ? e.message : String(e));
            setPaymentStatus("PAYMENT_FAILED");
          } finally {
            setVerifying(false);
          }
        },
        modal: {
          ondismiss: () => {
            setPaymentStatus((prev) => (prev === "PAYMENT_SUCCESS" ? prev : "PAYMENT_UNKNOWN"));
          },
        },
        theme: { color: "#0b5fff" },
      };
      const RazorpayCtor = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;
      if (!RazorpayCtor) throw new Error("Razorpay not loaded");
      const rzp = new RazorpayCtor(options);
      rzp.open();
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Reset approval/checkout when cart hash changes (cart mutated)
  React.useEffect(() => {
    setApproval(null);
    setPolicy(null);
    setApprovalError(null);
    setCheckoutOrder(null);
    setCheckoutError(null);
    setPaymentSuccess(null);
    setPaymentStatus(null);
  }, [cart?.hash]);

  if (!cart) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Your Cart</CardTitle>
          <CardDescription>Server-authoritative • hash: —</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-[var(--muted-foreground)]">Loading cart…</p>
        </CardContent>
      </Card>
    );
  }

  if (cart.items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-[14px]">Your Cart</CardTitle>
          <CardDescription>Cart ID: {cart.id.slice(0, 8)}… • {cart.currency} • hash: {cart.hash.slice(0, 8)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-md border border-dashed border-[var(--border)] bg-[#f9fafb] p-4 text-center text-[12px] text-[var(--muted-foreground)]">
            Cart empty — add products from recommendations or browse. Prices are server-authoritative.
          </div>
          {(error || approvalError) && <p className="text-[12px] text-[#e11d48]">{error ?? approvalError}</p>}
          {approval && (
            <div className="rounded-md border border-[#a7f3d0] bg-[#ecfdf5] p-3">
              <p className="text-[13px] font-semibold text-[#065f46]">APPROVED</p>
              <p className="text-[12px] text-[#065f46]">Approved. Ready for checkout.</p>
              <p className="text-[11px] font-mono break-all text-[#065f46]">Transaction {approval.id.slice(0, 8)} • {approval.status}</p>
            </div>
          )}
          {policy && (
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-[12px] font-medium">Policy: {policy.passed}/{policy.total} passed</p>
              <ul className="mt-1 text-[11px] leading-4">
                {policy.checks.map((c) => (
                  <li key={c.id} className={c.passed ? "text-[#065f46]" : "text-[#e11d48]"}>
                    {c.passed ? "✓" : "✗"} {c.name}: {c.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button
            size="lg"
            className="w-full"
            onClick={handleApprove}
            loading={approving}
            disabled={approving || loading || !cart.hash || cart.items.length === 0}
          >
            Approve & Pay
          </Button>
          <p className="text-[11px] text-[var(--muted-foreground)]">Cart hash: {cart.hash} • total paise: {cart.totals.total}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden min-w-0">
      <CardHeader>
        <CardTitle className="text-[14px]">Your Cart • {cart.totals.itemCount} items</CardTitle>
        <CardDescription className="break-all">
          Cart ID: {cart.id.slice(0, 8)}… • {cart.currency} • hash: <span className="font-mono text-[11px] break-all">{cart.hash.slice(0, 12)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 min-w-0">
        {error ? <p className="text-[12px] text-[#e11d48] break-all">{error}</p> : null}
        <div className="flex flex-col gap-2 min-w-0">
          {cart.items.map((it) => (
            <div key={it.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 rounded-md border border-[var(--border)] bg-white p-3 min-w-0 overflow-hidden">
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[13px] font-medium truncate">{it.product.name}</span>
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {it.currency} {it.unitPrice} paise × {it.quantity} = ₹{(it.unitPrice * it.quantity / 100).toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-7 w-7"
                  disabled={loading || it.quantity <= 1}
                  onClick={() => updateQuantity(it.id, it.quantity - 1)}
                >
                  −
                </Button>
                <span className="w-6 text-center text-[13px] font-medium">{it.quantity}</span>
                <Button
                  size="icon"
                  variant="secondary"
                  className="h-7 w-7"
                  disabled={loading || it.quantity >= 10}
                  onClick={() => updateQuantity(it.id, it.quantity + 1)}
                >
                  +
                </Button>
                <Button size="sm" variant="ghost" onClick={() => removeItem(it.id)} disabled={loading}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Subtotal</span>
            <span className="font-medium">₹{(cart.totals.subtotal / 100).toLocaleString("en-IN")}</span>
          </div>
          <div className="flex justify-between font-semibold text-[14px]">
            <span>Total</span>
            <span>₹{(cart.totals.total / 100).toLocaleString("en-IN")}</span>
          </div>
          <p className="text-[11px] leading-4 text-[var(--muted-foreground)]">
            Hash: <span className="font-mono break-all">{cart.hash}</span> • currency: {cart.currency} • deterministic from server prices
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => clearCart()} disabled={loading || approving}>
            Clear cart
          </Button>
          <Button
            size="lg"
            className="flex-1"
            onClick={handleApprove}
            loading={approving}
            disabled={approving || loading || !cart.hash || cart.items.length === 0}
          >
            Approve & Pay
          </Button>
        </div>
        {approvalError && <p className="text-[12px] text-[#e11d48]">{approvalError}</p>}
        {approval && (
          <div className="rounded-md border border-[#a7f3d0] bg-[#ecfdf5] p-3">
            <p className="text-[13px] font-semibold text-[#065f46]">{approval.status}</p>
            <p className="text-[12px] text-[#065f46]">Approved. Ready for checkout.</p>
            <p className="text-[11px] font-mono break-all text-[#065f46]">Transaction {approval.id.slice(0, 8)} • {approval.status} • hash {approval.cartHash.slice(0, 8)}</p>
          </div>
        )}
        {policy && (
          <div className="rounded-md border border-[var(--border)] bg-white p-3">
            <p className="text-[12px] font-medium">Policy: {policy.passed}/{policy.total} passed</p>
            <ul className="mt-1 text-[11px] leading-4 max-h-[120px] overflow-y-auto">
              {policy.checks.map((c) => (
                <li key={c.id} className={c.passed ? "text-[#065f46]" : "text-[#e11d48]"}>
                  {c.passed ? "✓" : "✗"} {c.name}: {c.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Phase 6 Checkout — visible only after APPROVED, uses server amount/orderId, never client override */}
        {approval && approval.status === "APPROVED" && !paymentSuccess && (
          <div className="flex flex-col gap-2 rounded-md border border-[#bfdbfe] bg-[#eff6ff] p-3">
            <p className="text-[12px] font-medium text-[#1e40af]">Checkout — Razorpay TEST</p>
            <p className="text-[11px] text-[#1e40af] break-all">Transaction {approval.id.slice(0, 8)} • amount from server after order creation</p>
            {checkoutOrder && (
              <div className="rounded-md border border-[var(--border)] bg-white p-2 text-[11px] break-all">
                <p>Order: <span className="font-mono">{checkoutOrder.razorpayOrderId.slice(0, 16)}…</span></p>
                <p>Amount: ₹{(checkoutOrder.amount / 100).toLocaleString("en-IN")} • {checkoutOrder.currency}</p>
                <p>KeyId: <span className="font-mono">{checkoutOrder.keyId.slice(0, 12)}…</span></p>
              </div>
            )}
            <Button
              size="lg"
              className="w-full"
              onClick={handleCheckout}
              loading={checkoutLoading || verifying}
              disabled={checkoutLoading || verifying || !approval}
            >
              {checkoutOrder ? "Pay with Razorpay" : "Checkout"}
            </Button>
            {checkoutError && <p className="text-[11px] text-[#e11d48] break-all">{checkoutError}</p>}
            {verifying && <p className="text-[11px] text-[#1e40af]">Verifying payment with server…</p>}
            <p className="text-[10px] text-[var(--muted-foreground)]">Amount and orderId come from server. Browser receives keyId only.</p>
          </div>
        )}
        {paymentSuccess && (
          <div className="rounded-md border border-[#a7f3d0] bg-[#ecfdf5] p-3">
            <p className="text-[13px] font-semibold text-[#065f46]">PAYMENT_SUCCESS</p>
            <p className="text-[12px] text-[#065f46]">Payment verified by server. Order completed.</p>
            <p className="text-[11px] font-mono break-all text-[#065f46]">Transaction {paymentSuccess.transactionId.slice(0, 8)} • {paymentSuccess.status} • payment {paymentSuccess.razorpayPaymentId.slice(0, 12)}…</p>
            {checkoutOrder && <p className="text-[11px] text-[#065f46] break-all">Amount ₹{(checkoutOrder.amount / 100).toLocaleString("en-IN")} • {checkoutOrder.currency}</p>}
          </div>
        )}
        {paymentStatus && !paymentSuccess && paymentStatus !== "PAYMENT_SUCCESS" && (
          <div className="rounded-md border border-[var(--border)] bg-white p-2">
            <p className="text-[11px] text-[var(--muted-foreground)]">
              {paymentStatus === "PAYMENT_UNKNOWN"
                ? "Payment cancelled. Server status: PAYMENT_PENDING (you can retry checkout)."
                : `Payment status: ${paymentStatus}`}
            </p>
            {checkoutError && <p className="text-[11px] text-[#e11d48] break-all">{checkoutError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ShopChat({ initialProducts }: { initialProducts: ApiProduct[] }) {
  const [input, setInput] = React.useState("");
  // Stable conversationId for the lifetime of this page so follow-ups share context.
  // Lazy initializer runs once on mount, not during render — safe for impure calls.
  const [conversationId, setConversationId] = React.useState<string>(() =>
    `shop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  );
  // Bump to clear context when the user starts a new chat
  const newConversation = () =>
    setConversationId(`shop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Hi! I'm your shopping assistant. Tell me what you're looking for — for example, 'I need headphones for working from home under ₹5,000.' I'll ask a quick follow-up if I need more context, then recommend from our real catalog.",
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const cartHook = useCart();
  const { addItem } = cartHook;

  const allIds = React.useMemo(() => {
    const ids: string[] = [];
    for (const m of messages) {
      for (const r of m.recommendations ?? []) ids.push(r.productId);
      for (const r of m.upsell ?? []) ids.push(r.productId);
      for (const r of m.crossSell ?? []) ids.push(r.productId);
    }
    return [...new Set(ids)];
  }, [messages]);

  const { map: productMap } = useProducts(allIds);
  const [addingId, setAddingId] = React.useState<string | null>(null);
  const [addError, setAddError] = React.useState<string | null>(null);

  // Auto-scroll to the latest message — also when product cards finish
  // loading (they grow the container) or the user scrolls manually the
  // sentinel keeps the view pinned to the bottom.
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const chatLogRef = React.useRef<HTMLDivElement | null>(null);
  const allIdsKey = allIds.join(",");
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, allIdsKey]);

  const handleAdd = async (productId: string) => {
    setAddingId(productId);
    setAddError(null);
    try {
      await addItem(productId, 1);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingId(null);
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 1000) {
      setError(trimmed.length === 0 ? "Please enter a message." : "Message too long (max 1000).");
      return;
    }
    setError(null);
    const userMsg: ChatMessage = { id: `u_${Date.now()}`, role: "user", text: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, conversationId }),
      });
      const body = await res.json();
      if (!res.ok) {
        const msg = body?.error?.message ?? "Agent unavailable";
        setError(msg);
        setMessages((prev) => [...prev, { id: `e_${Date.now()}`, role: "assistant", text: msg }]);
        return;
      }
      const reply = body.reply as {
        message: string;
        recommendations: { productId: string; reason: string; confidence: string }[];
        upsell?: { productId: string; reason: string; confidence: string }[];
        crossSell?: { productId: string; reason: string; confidence: string }[];
      };
      const assistant: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        text: reply.message,
        recommendations: reply.recommendations ?? [],
        upsell: reply.upsell ?? [],
        crossSell: reply.crossSell ?? [],
        meta: body.meta,
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Network error";
      setError(msg);
      setMessages((prev) => [...prev, { id: `e_${Date.now()}`, role: "assistant", text: `Agent error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const clearConversation = () => {
    newConversation();
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        text: "Fresh start. What are you shopping for today?",
      },
    ]);
    setError(null);
  };

  return (
    <div className="grid min-h-0 gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-4 min-h-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-[14px]">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0b5fff] text-white text-[11px]">✦</span>
              Shopping assistant
              <Badge variant="neutral">{initialProducts.length} in catalog</Badge>
            </CardTitle>
            <CardDescription>Ask in natural language — the assistant remembers context within this chat. Prices and product data are always pulled from the live catalog. The assistant never adds to your cart for you.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col gap-4">
            <div
              ref={chatLogRef}
              role="log"
              aria-live="polite"
              aria-label="Chat history"
              className="flex min-h-0 flex-col gap-3 max-h-[min(480px,55vh)] min-h-[200px] overflow-y-auto overscroll-contain rounded-[12px] border border-[var(--border)] bg-[#f8fafc] p-4"
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  data-testid={`chat-msg-${m.role}`}
                  className={
                    m.role === "user"
                      ? "self-end max-w-[80%] min-w-0 overflow-hidden rounded-[12px] bg-[var(--primary)] px-3 py-2 text-[13px] text-white"
                      : "self-start max-w-[88%] min-w-0 overflow-hidden rounded-[12px] bg-white border border-[var(--border)] px-3 py-2 text-[13px] leading-5 shadow-[var(--shadow-card)]"
                  }
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.role === "assistant" && m.recommendations && m.recommendations.length > 0 ? (
                    <div className="mt-3 grid gap-3 min-w-0">
                      {m.recommendations.map((r) => {
                        const prod = productMap[r.productId];
                        return (
                          <div key={r.productId} className="rounded-[8px] border border-[var(--border)] bg-[#f9fafb] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-semibold">{prod ? prod.name : r.productId}</span>
                              {prod ? <span className="text-[12px] font-medium text-[#0ba36a]">{prod.priceDisplay}</span> : <span className="text-[11px] text-[var(--muted-foreground)]">loading…</span>}
                            </div>
                            {prod ? <p className="mt-1 text-[11px] text-[var(--muted-foreground)]">{prod.description.slice(0, 90)}… • {prod.available ? "In stock" : "Unavailable"}</p> : null}
                            <p className="mt-1 text-[12px] leading-4 text-[#1e40af]">↳ {r.reason}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="rounded-full bg-white border border-[var(--border)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{r.confidence}</span>
                              <Button size="sm" variant="primary" className="ml-auto" disabled={!prod || !prod.available} loading={addingId === r.productId} onClick={() => handleAdd(r.productId)}>
                                Add to cart
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {m.upsell && m.upsell.length > 0 ? (
                        <div className="rounded-[8px] border border-[#bfdbfe] bg-[#eff6ff] p-3">
                          <p className="text-[12px] font-semibold text-[#1e40af]">Optional add-on (won&apos;t be added automatically)</p>
                          {m.upsell.map((u) => {
                            const prod = productMap[u.productId];
                            return (
                              <div key={u.productId} className="mt-2 flex items-center justify-between gap-2">
                                <span className="text-[12px] truncate">{prod ? prod.name : u.productId}</span>
                                <div className="flex items-center gap-2">
                                  {prod ? <span className="text-[12px] font-medium whitespace-nowrap">{prod.priceDisplay}</span> : null}
                                  <Button size="sm" variant="secondary" disabled={!prod || !prod.available} loading={addingId === u.productId} onClick={() => handleAdd(u.productId)}>
                                    Add
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                          <p className="mt-1 text-[11px] text-[#1e40af]">{m.upsell[0]?.reason}</p>
                        </div>
                      ) : null}
                      {m.crossSell && m.crossSell.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {m.crossSell.map((c) => {
                            const prod = productMap[c.productId];
                            return <Badge key={c.productId} variant="outline">{prod ? prod.name : c.productId}</Badge>;
                          })}
                        </div>
                      ) : null}
                      {m.meta ? (
                        <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">
                          tools: {m.meta.toolsUsed.join(", ")} • {m.meta.latencyMs}ms{typeof m.meta.llm === "string" ? ` • ${m.meta.llm}` : ""}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
              {loading ? (
                <div data-testid="chat-thinking" className="self-start flex items-center gap-2 rounded-full bg-white border border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--muted-foreground)]">
                  <span className="inline-flex gap-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce" style={{ animationDelay: "120ms" }} />
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)] animate-bounce" style={{ animationDelay: "240ms" }} />
                  </span>
                  <span>Thinking…</span>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex-1">
                <Input
                  placeholder="e.g. headphones under ₹5000 for WFH"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (!loading) send(input);
                    }
                  }}
                  disabled={loading}
                  maxLength={1000}
                  aria-label="Chat message"
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => send(input)} loading={loading} disabled={loading || input.trim().length === 0}>
                  Send
                </Button>
                <Button variant="secondary" onClick={clearConversation} disabled={loading} aria-label="Clear conversation">
                  New chat
                </Button>
              </div>
            </div>
            {error || cartHook.error || addError ? <p className="text-[12px] text-[#e11d48]">{error ?? cartHook.error ?? addError}</p> : null}
            <p className="text-[11px] text-[var(--muted-foreground)]">
              The assistant can only suggest products and explain matches. Adding to cart, approving, and checkout are always your explicit actions.
            </p>
          </CardContent>
        </Card>

        <div>
          <h3 className="mb-3 text-[13px] font-semibold">Browse catalog (server, {initialProducts.length})</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {initialProducts.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} variant="shop" onAdd={handleAdd} loading={addingId === p.id} />
            ))}
          </div>
          {addError ? <p className="mt-2 text-[12px] text-[#e11d48]">{addError}</p> : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <CartPanel
          cart={cartHook.cart}
          loading={cartHook.loading}
          error={cartHook.error}
          updateQuantity={cartHook.updateQuantity}
          removeItem={cartHook.removeItem}
          clearCart={cartHook.clearCart}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">Why this price?</CardTitle>
          </CardHeader>
          <CardContent className="text-[12px] leading-5 text-[var(--muted-foreground)]">
            Price comes from <span className="font-mono bg-[#f3f4f6] px-1 rounded">Product.price (paise)</span> via CatalogService, not the assistant. The assistant can suggest matches; the server is always the source of truth.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
