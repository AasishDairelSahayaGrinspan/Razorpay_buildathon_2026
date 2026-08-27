import { describe, it, expect } from "vitest";
import { z } from "zod";

// Mirror schemas from routes for validation coverage without booting Next server
const SearchSchema = z.object({
  query: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  activeOnly: z.enum(["true", "false"]).optional(),
});

describe("API validation — Phase 2", () => {
  it("valid search params pass", () => {
    expect(SearchSchema.safeParse({ query: "headphones", maxPrice: "500000", limit: "10" }).success).toBe(true);
    expect(SearchSchema.safeParse({}).success).toBe(true);
  });

  it("rejects negative maxPrice", () => {
    expect(SearchSchema.safeParse({ maxPrice: "-100" }).success).toBe(false);
  });

  it("rejects non-integer price", () => {
    expect(SearchSchema.safeParse({ maxPrice: "100.5" }).success).toBe(false);
  });

  it("rejects limit > 50", () => {
    expect(SearchSchema.safeParse({ limit: "100" }).success).toBe(false);
  });

  it("rejects query too long", () => {
    expect(SearchSchema.safeParse({ query: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects invalid activeOnly", () => {
    expect(SearchSchema.safeParse({ activeOnly: "maybe" }).success).toBe(false);
  });

  it("price is integer paise validation", () => {
    const valid = SearchSchema.safeParse({ maxPrice: "100000" });
    expect(valid.success && Number.isInteger(valid.data.maxPrice!)).toBe(true);
  });
});
