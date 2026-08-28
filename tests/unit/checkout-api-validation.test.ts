import { describe, it, expect } from "vitest";
import { z } from "zod";

const CheckoutOrderSchema = z
  .object({
    transactionId: z.string().min(1).max(100),
  })
  .strict();

const CheckoutVerifySchema = z
  .object({
    transactionId: z.string().min(1).max(100),
    razorpayOrderId: z.string().min(1).max(100),
    razorpayPaymentId: z.string().min(1).max(100),
    razorpaySignature: z.string().min(1).max(200),
  })
  .strict();

describe("Checkout API validation — Phase 6", () => {
  describe("POST /api/checkout/order", () => {
    it("accepts only transactionId", () => {
      const valid = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc123" });
      expect(valid.success).toBe(true);
    });

    it("rejects amount injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", amount: 10000 } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects total injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", total: 10000 } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects currency injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", currency: "USD" } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects razorpayOrderId injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", razorpayOrderId: "order_evil" } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects price injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", price: 100 } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects keyId injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", keyId: "evil_key" } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects keySecret injection", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", keySecret: "secret" } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects empty transactionId", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "" });
      expect(r.success).toBe(false);
    });

    it("rejects unknown extra fields", () => {
      const r = CheckoutOrderSchema.safeParse({ transactionId: "txn_abc", foo: "bar" } as unknown as object);
      expect(r.success).toBe(false);
    });
  });

  describe("POST /api/checkout/verify", () => {
    it("accepts valid verify payload", () => {
      const valid = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "signature_hex_64chars_abcdef1234567890abcdef1234567890abcdef1234567890abcdef12",
      });
      expect(valid.success).toBe(true);
    });

    it("rejects amount injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        amount: 10000,
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects total injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        total: 10000,
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects currency injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        currency: "USD",
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects price injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        price: 100,
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects keyId injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        keyId: "evil",
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects keySecret injection", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        keySecret: "secret",
      } as unknown as object);
      expect(r.success).toBe(false);
    });

    it("rejects missing signature", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "",
      });
      expect(r.success).toBe(false);
    });

    it("rejects unknown extra fields", () => {
      const r = CheckoutVerifySchema.safeParse({
        transactionId: "txn_abc",
        razorpayOrderId: "order_xyz",
        razorpayPaymentId: "pay_123",
        razorpaySignature: "sig",
        foo: "bar",
      } as unknown as object);
      expect(r.success).toBe(false);
    });
  });
});
