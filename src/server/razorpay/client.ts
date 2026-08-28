// Phase 9: isolated server-only Razorpay SDK boundary
// Single source of truth for Razorpay order creation. Exposes a small surface
// so the checkout service can:
//   - retry once on transient failures
//   - be tested by injecting a fake transport (without weakening security)
//
// SECURITY: This module is server-only. Agent security wall in eslint.config.mjs
// blocks `razorpay` SDK import from src/server/agent/**. This boundary is the
// ONLY place in the app that talks to the Razorpay SDK.

import Razorpay from "razorpay";

export type RazorpayOrderInput = {
  amount: number; // paise
  currency: string;
  receipt: string;
  notes: Record<string, string>;
};

export type RazorpayOrderResult = {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status?: string;
};

export type RazorpayClient = {
  createOrder(input: RazorpayOrderInput): Promise<RazorpayOrderResult>;
};

function getRazorpayKeys(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw Object.assign(new Error("Razorpay keys not configured"), {
      code: "RAZORPAY_CONFIG_MISSING",
      status: 500,
    });
  }
  return { keyId, keySecret };
}

function realClient(): RazorpayClient {
  const { keyId, keySecret } = getRazorpayKeys();
  const sdk = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return {
    async createOrder(input: RazorpayOrderInput) {
      const created = await sdk.orders.create({
        amount: input.amount,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes,
      });
      return {
        id: created.id,
        amount: (created as { amount: number }).amount,
        currency: (created as { currency: string }).currency,
        receipt: (created as { receipt: string }).receipt,
        status: (created as { status?: string }).status,
      };
    },
  };
}

// Process-wide client slot. Tests can swap this with a fake via __setRazorpayClient.
let _client: RazorpayClient | null = null;
export function getRazorpayClient(): RazorpayClient {
  if (_client) return _client;
  _client = realClient();
  return _client;
}

// Test seam — only used by unit tests. Server-only path is preserved.
export function __setRazorpayClient(client: RazorpayClient | null): void {
  _client = client;
}
