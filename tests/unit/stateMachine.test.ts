import { describe, it, expect } from "vitest";
import { canTransition, transition } from "@/server/transaction/stateMachine";

describe("StateMachine — 11 states, Phase 6/9", () => {
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
  it("rejects APPROVED → PAYMENT_SUCCESS (forbidden shortcut)", () => {
    expect(canTransition("APPROVED", "PAYMENT_SUCCESS")).toBe(false);
    expect(() => transition("APPROVED", "PAYMENT_SUCCESS")).toThrow(/Invalid transition/);
  });
  it("allows APPROVED → ORDER_CREATED (Phase 6)", () => {
    expect(canTransition("APPROVED", "ORDER_CREATED")).toBe(true);
    expect(() => transition("APPROVED", "ORDER_CREATED")).not.toThrow();
  });
  it("rejects APPROVED → ORDER_CREATING (forbidden)", () => {
    expect(canTransition("APPROVED", "ORDER_CREATING")).toBe(false);
  });
  it("rejects DRAFT → APPROVED (skip)", () => {
    expect(canTransition("DRAFT", "APPROVED")).toBe(false);
  });
  it("rejects CART_READY → APPROVED (skip)", () => {
    expect(canTransition("CART_READY", "APPROVED")).toBe(false);
  });
  it("ORDER_CREATING → ORDER_CREATED allowed (legacy)", () => {
    expect(canTransition("ORDER_CREATING", "ORDER_CREATED")).toBe(true);
  });
  it("PAYMENT_PROCESSING → PAYMENT_SUCCESS allowed (Phase 6)", () => {
    expect(canTransition("PAYMENT_PROCESSING", "PAYMENT_SUCCESS")).toBe(true);
  });
  it("invalid transitions rejected", () => {
    expect(canTransition("DRAFT", "PAYMENT_FAILED")).toBe(false);
    expect(canTransition("CART_READY", "PAYMENT_UNKNOWN")).toBe(false);
    expect(canTransition("APPROVED", "DRAFT")).toBe(false);
  });

  // Phase 9: failure/UNKNOWN transitions
  it("Phase 9: allows PAYMENT_PENDING → PAYMENT_FAILED", () => {
    expect(canTransition("PAYMENT_PENDING", "PAYMENT_FAILED")).toBe(true);
    expect(() => transition("PAYMENT_PENDING", "PAYMENT_FAILED")).not.toThrow();
  });
  it("Phase 9: allows PAYMENT_PENDING → PAYMENT_UNKNOWN", () => {
    expect(canTransition("PAYMENT_PENDING", "PAYMENT_UNKNOWN")).toBe(true);
    expect(() => transition("PAYMENT_PENDING", "PAYMENT_UNKNOWN")).not.toThrow();
  });
  it("Phase 9: allows PAYMENT_PROCESSING → PAYMENT_FAILED", () => {
    expect(canTransition("PAYMENT_PROCESSING", "PAYMENT_FAILED")).toBe(true);
    expect(() => transition("PAYMENT_PROCESSING", "PAYMENT_FAILED")).not.toThrow();
  });
  it("Phase 9: allows PAYMENT_PROCESSING → PAYMENT_UNKNOWN", () => {
    expect(canTransition("PAYMENT_PROCESSING", "PAYMENT_UNKNOWN")).toBe(true);
    expect(() => transition("PAYMENT_PROCESSING", "PAYMENT_UNKNOWN")).not.toThrow();
  });

  // Phase 9: forbidden shortcuts — must never reach SUCCESS without proper path
  it("Phase 9: rejects DRAFT → PAYMENT_SUCCESS", () => {
    expect(canTransition("DRAFT", "PAYMENT_SUCCESS")).toBe(false);
  });
  it("Phase 9: rejects DRAFT → PAYMENT_FAILED", () => {
    expect(canTransition("DRAFT", "PAYMENT_FAILED")).toBe(false);
  });
  it("Phase 9: rejects DRAFT → PAYMENT_UNKNOWN", () => {
    expect(canTransition("DRAFT", "PAYMENT_UNKNOWN")).toBe(false);
  });
  it("Phase 9: rejects APPROVED → PAYMENT_PROCESSING (forbidden shortcut)", () => {
    expect(canTransition("APPROVED", "PAYMENT_PROCESSING")).toBe(false);
    expect(() => transition("APPROVED", "PAYMENT_PROCESSING")).toThrow(/Invalid transition/);
  });
  it("Phase 9: rejects ORDER_CREATED → PAYMENT_SUCCESS (forbidden shortcut)", () => {
    expect(canTransition("ORDER_CREATED", "PAYMENT_SUCCESS")).toBe(false);
    expect(() => transition("ORDER_CREATED", "PAYMENT_SUCCESS")).toThrow(/Invalid transition/);
  });
  it("Phase 9: rejects ORDER_CREATED → PAYMENT_PROCESSING (must go through PAYMENT_PENDING)", () => {
    expect(canTransition("ORDER_CREATED", "PAYMENT_PROCESSING")).toBe(false);
  });
  it("Phase 9: rejects PAYMENT_PENDING → PAYMENT_SUCCESS (must go through PAYMENT_PROCESSING)", () => {
    expect(canTransition("PAYMENT_PENDING", "PAYMENT_SUCCESS")).toBe(false);
    expect(() => transition("PAYMENT_PENDING", "PAYMENT_SUCCESS")).toThrow(/Invalid transition/);
  });

  // Phase 9: terminal states are absorbing
  it("Phase 9: PAYMENT_SUCCESS is terminal — no outgoing transitions", () => {
    for (const to of ["PAYMENT_FAILED", "PAYMENT_UNKNOWN", "PAYMENT_PENDING", "PAYMENT_PROCESSING", "APPROVED", "DRAFT"] as const) {
      expect(canTransition("PAYMENT_SUCCESS", to)).toBe(false);
    }
  });
  it("Phase 9: PAYMENT_FAILED is terminal — no outgoing transitions", () => {
    for (const to of ["PAYMENT_SUCCESS", "PAYMENT_UNKNOWN", "PAYMENT_PENDING", "PAYMENT_PROCESSING"] as const) {
      expect(canTransition("PAYMENT_FAILED", to)).toBe(false);
    }
  });
  it("Phase 9: PAYMENT_UNKNOWN is terminal — no outgoing transitions", () => {
    for (const to of ["PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_PENDING", "PAYMENT_PROCESSING"] as const) {
      expect(canTransition("PAYMENT_UNKNOWN", to)).toBe(false);
    }
  });
});
