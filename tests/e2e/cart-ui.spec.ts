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
    // Add two different products
    const adds = page.getByRole("button", { name: /Add to cart —/ });
    await adds.nth(0).click();
    await page.waitForTimeout(1000);
    await adds.nth(1).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(/2 items/).first()).toBeVisible({ timeout: 8000 });

    // Remove first item — scroll into view to avoid header intercept on mobile
    const remove = page.getByRole("button", { name: "Remove" }).first();
    await remove.scrollIntoViewIfNeeded();
    // Wait for any pending cart update
    await page.waitForTimeout(500);
    await remove.click({ force: true });
    // After remove, cart should have 1 item left
    await expect(page.getByText(/1 items/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1, { timeout: 8000 });

    // Clear
    const clearBtn = page.getByRole("button", { name: "Clear cart" });
    await clearBtn.scrollIntoViewIfNeeded();
    await clearBtn.click({ force: true });
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
