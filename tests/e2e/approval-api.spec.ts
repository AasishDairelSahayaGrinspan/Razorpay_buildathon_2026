import { test, expect } from "@playwright/test";

test.describe("Approval API — POST /api/approval", () => {
  async function createCartWithProduct(request: import("@playwright/test").APIRequestContext) {
    const cartRes = await request.post("/api/cart", { data: {} });
    const { cart } = await cartRes.json();
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products.find((p: { inventory: number }) => p.inventory > 5);
    const add = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1 } });
    const addBody = await add.json();
    return { cart: addBody.cart, prod };
  }

  test("valid approval returns APPROVED and policy", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const res = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.transaction.status).toBe("APPROVED");
    expect(body.policy.passed).toBe(body.policy.total);
    expect(body.transaction.cartHash).toBe(cart.hash);
  });

  test("invalid Zod input rejected", async ({ request }) => {
    const res = await request.post("/api/approval", { data: { cartId: "", cartHash: "" } });
    expect(res.status()).toBe(400);
  });

  test("stale hash 409", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const res = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: "stale_hash_12345678" } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("STALE_CART");
  });

  test("empty cart policy fails 400", async ({ request }) => {
    const cartRes = await request.post("/api/cart", { data: {} });
    const { cart } = await cartRes.json();
    const res = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("POLICY_FAILED");
  });

  test("price injection rejected (currency, price, merchantId)", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const res = await request.post("/api/approval", {
      data: { cartId: cart.id, cartHash: cart.hash, price: 1, currency: "USD", merchantId: "evil" } as unknown as object,
    });
    expect(res.status()).toBe(400);
  });

  test("duplicate approval idempotent (same cart+hash)", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const first = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    const second = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect([200, 201]).toContain(second.status());
    const secondBody = await second.json();
    expect(secondBody.transaction.id).toBe(firstBody.transaction.id);
    expect(secondBody.isIdempotent).toBe(true);
  });

  test("concurrent duplicate results in single transaction", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const [a, b] = await Promise.all([
      request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } }),
      request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } }),
    ]);
    const aBody = await a.json();
    const bBody = await b.json();
    // Both should be 200/201 and same transaction id
    expect([200, 201]).toContain(a.status());
    expect([200, 201]).toContain(b.status());
    expect(aBody.transaction.id).toBe(bBody.transaction.id);
  });
});
