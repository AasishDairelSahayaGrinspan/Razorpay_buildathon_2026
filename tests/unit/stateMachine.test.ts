import { describe, it, expect } from "vitest";
import { canTransition, transition } from "@/server/transaction/stateMachine";

describe("StateMachine — 11 states, Phase 6 APPROVED→ORDER_CREATED→PAYMENT_PENDING", () => {
  it("allows DRAFT → CART_READY", () => {
    expect(canTransition("DRAFT", "CART_READY")).toBe(true);
    expect(() => transition("DRAFT", "CART_READY")).not.toThrow();
  });
  it("allows CART_READY → APPROVAL_PENDING", () => {
    expect(canTransition("CART_READY", "APPROVAL_PENDING")).toBe(true);
  });
  it("allows APPROVAL_PENDING → APPROVED", () => {
    expect(canTransition("APPROVAL_PENDING", "APPROVED")).toBe(true);
  });
  it("rejects APPROVED → PAYMENT_SUCCESS", () => {
    expect(canTransition("APPROVED", "PAYMENT_SUCCESS")).toBe(false);
    expect(() => transition("APPROVED", "PAYMENT_SUCCESS")).toThrow(/Invalid transition/);
  });
  it("allows APPROVED → ORDER_CREATED (Phase 6)", () => {
    expect(canTransition("APPROVED", "ORDER_CREATED")).toBe(true);
    expect(() => transition("APPROVED", "ORDER_CREATED")).not.toThrow();
  });
  it("rejects APPROVED → ORDER_CREATING", () => {
    expect(canTransition("APPROVED", "ORDER_CREATING")).toBe(false);
  });
  it("rejects DRAFT → APPROVED (skip)", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
  });
  it("rejects CART_READY → APPROVED (skip)", () => {
    expect(canTransition("CART_READY", "APPROVED")).toBe(false);
  });
  it("later states exist but Phase 5 not used — ORDER_CREATING → ORDER_CREATED allowed (for future)", () => {
    expect(canTransition("ORDER_CREATING", "ORDER_CREATED")).toBe(true);
  });
  it("PAYMENT_PROCESSING → PAYMENT_SUCCESS allowed (future)", () => {
    expect(canTransition("PAYMENT_PROCESSING", "PAYMENT_SUCCESS")).toBe(true);
  });
  it("invalid transitions rejected", () => {
    expect(canTransition("DRAFT", "PAYMENT_FAILED")).toBe(false);
    expect(canTransition("CART_READY", "PAYMENT_UNKNOWN")).toBe(false);
    expect(canTransition("APPROVED", "DRAFT")).toBe(false);
  });
});
