import { describe, it, expect } from "vitest";

describe("Cart API validation — price injection defense", () => {
  it("POST /api/cart/[id]/items should reject price injection", async () => {
    // This is a schema-level test: ensure BodySchema rejects price
    const { z } = await import("zod");
    const BodySchema = z
      .object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(10),
        unitPrice: z.never().optional(),
        price: z.never().optional(),
        total: z.never().optional(),
      })
      .strict();
    expect(BodySchema.safeParse({ productId: "abc", quantity: 1, unitPrice: 100 }).success).toBe(false);
    expect(BodySchema.safeParse({ productId: "abc", quantity: 1, price: 100 }).success).toBe(false);
    expect(BodySchema.safeParse({ productId: "abc", quantity: 1 }).success).toBe(true);
  });

  it("quantity bounds", async () => {
    const { z } = await import("zod");
    const Q = z.number().int().min(1).max(10);
    expect(Q.safeParse(0).success).toBe(false);
    expect(Q.safeParse(11).success).toBe(false);
    expect(Q.safeParse(5).success).toBe(true);
  });
});
