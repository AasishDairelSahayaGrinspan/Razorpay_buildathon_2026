import type { PolicyCheck } from "./types";

export function check(id: string, name: string, passed: boolean, message: string): PolicyCheck {
  return { id, name, passed, message };
}

// Helper to create check registry
export type CheckFn = (ctx: CheckContext) => Promise<PolicyCheck> | PolicyCheck;

export type CheckContext = {
  cart: {
    id: string;
    merchantId: string;
    currency: string;
    status: string;
    items: { productId: string; quantity: number; unitPrice: number; currency: string }[];
    totals: { total: number; subtotal: number; currency: string };
    hash: string;
  } | null;
  clientCartHash: string;
  products: Map<string, { id: string; price: number; currency: string; active: boolean; inventory: number; merchantId: string }>;
};

export const SUPPORTED_CURRENCIES = ["INR"];
