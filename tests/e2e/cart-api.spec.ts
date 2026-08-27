import { test, expect } from "@playwright/test";

test.describe("Cart APIs — Phase 4", () => {
  test("creates cart and adds item with server price", async ({ request }) => {
    const create = await request.post("/api/cart", { data: {} });
    expect(create.status()).toBe(201);
    const { cart } = await create.json();
    expect(cart.items.length).toBe(0);
    expect(cart.totals.total).toBe(0);
    expect(cart.hash).toBeDefined();

    // Get a product
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products.find((p: { inventory: number }) => p.inventory > 5);
    const price = prod.price;

    const add = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 2 } });
    expect(add.status()).toBe(200);
    const { cart: updated } = await add.json();
    expect(updated.items.length).toBe(1);
    expect(updated.items[0].unitPrice).toBe(price);
    expect(updated.items[0].quantity).toBe(2);
    expect(updated.totals.total).toBe(price * 2);
    expect(updated.hash).not.toBe(cart.hash);
  });

  test("rejects client price injection", async ({ request }) => {
    const create = await request.post("/api/cart", { data: {} });
    const { cart } = await create.json();
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products[0];

    const bad = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1, unitPrice: 1, price: 1 } as unknown as object });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.message).toMatch(/price injection/i);
  });

  test("rejects invalid product, inactive, insufficient inventory", async ({ request }) => {
    const create = await request.post("/api/cart", { data: {} });
    const { cart } = await create.json();

    const badId = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: "not_exist_123", quantity: 1 } });
    expect(badId.status()).toBe(404);

    const all = await request.get("/api/products?activeOnly=false");
    const { products } = await all.json();
    const inactive = products.find((p: { active: boolean }) => !p.active);
    if (inactive) {
      const res = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: inactive.id, quantity: 1 } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe("PRODUCT_INACTIVE");
    }

    const oos = products.find((p: { inventory: number; active: boolean }) => p.inventory === 0 && p.active);
    if (oos) {
      const res = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: oos.id, quantity: 1 } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe("INSUFFICIENT_INVENTORY");
    }
  });

  test("quantity update, remove, clear", async ({ request }) => {
    const create = await request.post("/api/cart", { data: {} });
    const { cart } = await create.json();
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products.find((p: { inventory: number }) => p.inventory > 10);

    await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1 } });
    const get = await request.get(`/api/cart/${cart.id}`);
    const body = await get.json();
    const itemId = body.cart.items[0].id;

    const upd = await request.patch(`/api/cart/${cart.id}/items/${itemId}`, { data: { quantity: 3 } });
    expect(upd.status()).toBe(200);
    expect((await upd.json()).cart.totals.total).toBe(prod.price * 3);

    const badQty = await request.patch(`/api/cart/${cart.id}/items/${itemId}`, { data: { quantity: 0 } });
    expect(badQty.status()).toBe(400);

    const del = await request.delete(`/api/cart/${cart.id}/items/${itemId}`);
    expect(del.status()).toBe(200);
    expect((await del.json()).cart.items.length).toBe(0);

    // Add two then clear
    await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1 } });
    const prod2 = products.find((p: { id: string }) => p.id !== prod.id);
    await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod2.id, quantity: 1 } });
    const clear = await request.post(`/api/cart/${cart.id}/clear`);
    expect(clear.status()).toBe(200);
    expect((await clear.json()).cart.items.length).toBe(0);
  });

  test("cart hash determinism via API", async ({ request }) => {
    const create = await request.post("/api/cart", { data: {} });
    const { cart } = await create.json();
    const hash1 = cart.hash;
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products[0];
    const add = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1 } });
    const hash2 = (await add.json()).cart.hash;
    expect(hash2).not.toBe(hash1);
    // Fetch again same hash
    const get = await request.get(`/api/cart/${cart.id}`);
    expect((await get.json()).cart.hash).toBe(hash2);
  });
});
