import { test, expect } from "@playwright/test";

test.describe("Catalog APIs — Phase 2 read-only", () => {
  test("GET /api/products returns active products with integer paise", async ({ request }) => {
    const res = await request.get("/api/products");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.products).toBeDefined();
    expect(body.count).toBeGreaterThanOrEqual(7);
    for (const p of body.products) {
      expect(Number.isInteger(p.price)).toBe(true);
      expect(p.currency).toBe("INR");
      expect(p.priceDisplay).toMatch(/₹/);
      expect(p.active).toBe(true);
    }
  });

  test("GET /api/products?activeOnly=false includes inactive", async ({ request }) => {
    const resAll = await request.get("/api/products?activeOnly=false");
    const bodyAll = await resAll.json();
    const resActive = await request.get("/api/products?activeOnly=true");
    const bodyActive = await resActive.json();
    expect(bodyAll.count).toBeGreaterThan(bodyActive.count);
    expect(bodyAll.products.some((p: { active: boolean }) => !p.active)).toBe(true);
  });

  test("GET /api/products/[id] returns product or 404", async ({ request }) => {
    const list = await request.get("/api/products");
    const { products } = await list.json();
    const id = products[0].id;
    const ok = await request.get(`/api/products/${id}`);
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.product.id).toBe(id);
    expect(body.product.price).toBe(products[0].price);

    const miss = await request.get("/api/products/does_not_exist_123");
    expect(miss.status()).toBe(404);
  });

  test("GET /api/products/[id]/availability reflects inventory/active", async ({ request }) => {
    const list = await request.get("/api/products?activeOnly=false");
    const { products } = await list.json();
    const activeAvail = products.find((p: { inventory: number; active: boolean }) => p.active && p.inventory > 0);
    const oos = products.find((p: { inventory: number; active: boolean }) => p.active && p.inventory === 0);
    const inactive = products.find((p: { active: boolean }) => !p.active);

    if (activeAvail) {
      const r = await request.get(`/api/products/${activeAvail.id}/availability`);
      const b = await r.json();
      expect(b.available).toBe(true);
      expect(b.active).toBe(true);
    }
    if (oos) {
      const r = await request.get(`/api/products/${oos.id}/availability`);
      const b = await r.json();
      expect(b.available).toBe(false);
      expect(b.inventory).toBe(0);
    }
    if (inactive) {
      const r = await request.get(`/api/products/${inactive.id}/availability`);
      const b = await r.json();
      expect(b.available).toBe(false);
      expect(b.active).toBe(false);
    }
  });

  test("GET /api/products/search validates query, filters correctly", async ({ request }) => {
    const res = await request.get("/api/products/search?query=headphones&maxPrice=500000");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.products.length).toBeGreaterThan(0);
    for (const p of body.products) {
      expect(p.price).toBeLessThanOrEqual(500000);
    }

    // validation error: limit too high
    const bad = await request.get("/api/products/search?limit=100");
    expect(bad.status()).toBe(400);

    // validation: min > max
    const bad2 = await request.get("/api/products/search?minPrice=500000&maxPrice=100000");
    expect(bad2.status()).toBe(400);

    // empty result handled
    const empty = await request.get("/api/products/search?query=zzzz_not_found_999");
    expect(empty.status()).toBe(200);
    expect((await empty.json()).count).toBe(0);
  });

  test("price is never client-provided — API always returns server price", async ({ request }) => {
    const res = await request.get("/api/products");
    const body = await res.json();
    // Even if client tries to POST (not allowed), GET is read-only — no mutation route exists
    const post = await request.post("/api/products", { data: { name: "fake", price: 1 } });
    // Should be 405 or 404, not create with fake price
    expect([404, 405]).toContain(post.status());
    // Original price unchanged
    const re = await request.get(`/api/products/${body.products[0].id}`);
    expect((await re.json()).product.price).toBe(body.products[0].price);
  });
});
