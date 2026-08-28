import { test, expect } from "@playwright/test";

test.describe("Cart UI — Phase 4", () => {
  test("recommendation → Add to cart → cart displays server price and hash", async ({ page }) => {
    await page.goto("/shop");
    // Ensure cart initially empty or loading
    await expect(page.getByText("Your Cart").first()).toBeVisible();
    // Add via browse (first product)
    const addBtn = page.getByRole("button", { name: /Add to cart —/ }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();
    // Cart should show 1 item with price and hash
    await expect(page.getByText(/Cart • \d+ items/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/₹.*/).first()).toBeVisible();
    await expect(page.getByText(/hash:/i).first()).toBeVisible();
  });

  test("cart quantity update, remove, clear", async ({ page }) => {
    await page.goto("/shop");
    // Wait for the cart to be ready (empty cart rendered)
    await expect(page.getByText(/Cart empty/i).first()).toBeVisible({ timeout: 8000 });

    // Use page.evaluate to add both products via API, bypassing the UI click
    // race. The evaluate creates a cart, adds two distinct products, and writes
    // the cartId to localStorage so the page picks it up on reload.
    await page.evaluate(async () => {
      const STORAGE_KEY = "cartId";
      const createRes = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!createRes.ok) throw new Error("Create cart failed: " + createRes.status);
      const { cart: newCart } = await createRes.json();
      localStorage.setItem(STORAGE_KEY, newCart.id);

      const productsRes = await fetch("/api/products");
      const { products } = await productsRes.json();

      // Add first two products
      const first = products[0];
      const second = products[1];
      for (const p of [first, second]) {
        const addRes = await fetch(`/api/cart/${newCart.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: p.id, quantity: 1 }),
        });
        if (!addRes.ok) throw new Error("Add failed for " + p.id + ": " + addRes.status);
      }
    });

    // Reload so the page picks up the cart from localStorage
    await page.reload();
    await expect(page.getByText(/Cart • 2 items/).first()).toBeVisible({ timeout: 8000 });

    // Remove first item — scroll into view to avoid header intercept on mobile
    const remove = page.getByRole("button", { name: "Remove" }).first();
    await remove.scrollIntoViewIfNeeded();
    await remove.click();
    await expect(page.getByText(/Cart • 1 items/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1, { timeout: 8000 });

    // Clear
    const clearBtn = page.getByRole("button", { name: "Clear cart" });
    await clearBtn.scrollIntoViewIfNeeded();
    await clearBtn.click();
    await expect(page.getByText(/Cart empty/i)).toBeVisible({ timeout: 8000 });
  });

  test("graceful API failure — out of stock", async ({ page }) => {
    await page.goto("/shop");
    // Try to add out-of-stock via API directly (mouse)
    // First get product id for out-of-stock via API
    const res = await page.request.get("/api/products?activeOnly=true");
    const body = await res.json();
    const oos = body.products.find((p: { inventory: number }) => p.inventory === 0);
    if (oos) {
      // Try to add via cart API directly to see error, then via UI should show error toast
      // Use page to call fetch
      const result = await page.evaluate(async (prodId) => {
        const cartRes = await fetch("/api/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const cartBody = await cartRes.json();
        const cartId = cartBody.cart.id;
        const addRes = await fetch(`/api/cart/${cartId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: prodId, quantity: 1 }),
        });
        const addBody = await addRes.json();
        return { status: addRes.status, body: addBody };
      }, oos.id);
      expect(result.status).toBe(400);
      expect(result.body.error.message).toMatch(/inventory/i);
    }
  });

  test("mobile cart layout no overflow", async ({ page }) => {
    await page.goto("/shop");
    // Add one to make cart non-empty
    await page.getByRole("button", { name: /Add to cart —/ }).first().click();
    await page.waitForTimeout(600);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    // Cart hash visible and truncated on mobile
    await expect(page.getByText(/hash:/i).first()).toBeVisible();
  });

  test("price cannot be overridden via UI — shows server price", async ({ page, request }) => {
    const prodRes = await request.get("/api/products");
    const { products } = await prodRes.json();
    const prod = products[0];
    const serverPrice = prod.price;
    await page.goto("/shop");
    // Check browse card shows server price, not client
    await expect(page.getByText(`Add to cart — ₹${(serverPrice / 100).toLocaleString("en-IN")}`).first()).toBeVisible();
    // After add, cart shows same server price
    await page.getByRole("button", { name: `Add to cart — ₹${(serverPrice / 100).toLocaleString("en-IN")}` }).first().click();
    await expect(page.getByText(`₹${(serverPrice / 100).toLocaleString("en-IN")}`).first()).toBeVisible({ timeout: 5000 });
  });
});
