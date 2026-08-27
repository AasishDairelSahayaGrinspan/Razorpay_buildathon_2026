export type TransactionStatus =
  | "DRAFT"
  | "CART_READY"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "ORDER_CREATING"
  | "ORDER_CREATED"
  | "PAYMENT_PENDING"
  | "PAYMENT_PROCESSING"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "PAYMENT_UNKNOWN";

// All 11 states exist in schema, but Phase 5 only allows first four transitions.
// Later states are defined but rejected until Phase 6.
const ALLOWED_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  DRAFT: ["CART_READY"],
  CART_READY: ["APPROVAL_PENDING"],
  APPROVAL_PENDING: ["APPROVED"],
  APPROVED: [], // Phase 5 STOP — later transitions rejected
  ORDER_CREATING: ["ORDER_CREATED"],
  ORDER_CREATED: ["PAYMENT_PENDING"],
  PAYMENT_PENDING: ["PAYMENT_PROCESSING"],
  PAYMENT_PROCESSING: ["PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_UNKNOWN"],
  PAYMENT_SUCCESS: [],
  PAYMENT_FAILED: [],
  PAYMENT_UNKNOWN: [],
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function transition(from: TransactionStatus, to: TransactionStatus): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Invalid transition ${from} → ${to}`), { code: "INVALID_TRANSITION", from, to });
  }
}

export const PHASE5_ALLOWED: TransactionStatus[] = ["DRAFT", "CART_READY", "APPROVAL_PENDING", "APPROVED"];
