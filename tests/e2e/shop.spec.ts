import { test, expect } from "@playwright/test";

test.describe("Phase 3 — Shop & Catalog (with Agent)", () => {
  test("redirects / to /shop", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/shop/);
  });

  test("shop hero renders with design system (Phase 3)", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByRole("heading", { name: /AI Commerce/i })).toBeVisible();
    await expect(page.getByPlaceholder(/e\.g\. headphones under/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
    await expect(page.getByText(/recommendation-only agent/i).first()).toBeVisible();
  });

  test("shop displays real catalog products (server-backed) via browse", async ({ page }) => {
    await page.goto("/shop");
    // Browse catalog header
    await expect(page.getByText(/Browse catalog/i)).toBeVisible();
    // Real seeded products (first 4 shown)
    await expect(page.getByText("Headphones — ANC WFH Pro")).toBeVisible();
    await expect(page.getByText("USB Microphone — Studio Mini")).toBeVisible();
    await expect(page.getByText("Webcam — HD Pro 1080p")).toBeVisible();
    // Out of stock shown on merchant page, not necessarily in browse (browse shows 4 cheapest)
    await expect(page.getByText(/Browse catalog.*server, 8/i)).toBeVisible();
  });

  test("cart preview shows server-pricing note", async ({ page }) => {
    await page.goto("/shop");
    await expect(page.getByText("Your Cart").first()).toBeVisible();
    await expect(page.getByText(/hash:/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve & Pay/i })).toBeVisible();
    await expect(page.getByText(/Why this price\?/i)).toBeVisible();
  });

  test("sidebar navigation and top bar TEST pill", async ({ page }) => {
    await page.goto("/shop");
    const isMobile = (page.viewportSize()?.width ?? 1280) < 1024;
    if (isMobile) {
      await page.getByLabel("Open menu").click();
      await expect(page.getByRole("link", { name: /AI Commerce/i })).toBeVisible();
      await expect(page.getByText("TEST").first()).toBeVisible();
      await expect(page.getByPlaceholder(/Search products/i)).toBeHidden();
    } else {
      await expect(page.getByText("Nimbus Commerce").first()).toBeVisible();
      await expect(page.getByRole("link", { name: /AI Commerce/i })).toBeVisible();
      await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Products" })).toBeVisible();
      await expect(page.getByText("TEST").first()).toBeVisible();
      await expect(page.getByPlaceholder(/Search products/i)).toBeVisible();
    }
  });

  test("merchant products displays real catalog", async ({ page }) => {
    await page.goto("/merchant/products");
    await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
    await expect(page.getByText("Headphones — ANC WFH Pro")).toBeVisible();
    await expect(page.getByText("399900").first()).toBeVisible();
    await expect(page.getByText("₹3,999").first()).toBeVisible();
    await expect(page.getByText("USB Microphone — Studio Mini")).toBeVisible();
    await expect(page.getByText("9 total")).toBeVisible();
    await expect(page.getByText("8 active")).toBeVisible();
    await expect(page.getByText("Available").first()).toBeVisible();
    await expect(page.getByText("Out of stock").first()).toBeVisible();
    await expect(page.getByText("Webcam Cover — Inactive Demo")).toBeVisible();
  });

  test("merchant dashboard shell intact", async ({ page }) => {
    await page.goto("/merchant");
    await expect(page.getByRole("heading", { name: "Merchant Overview" })).toBeVisible();
    await expect(page.getByText("Recent orders")).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI recommendations" })).toBeVisible();
  });

  test("no horizontal overflow on desktop and mobile", async ({ page }) => {
    for (const path of ["/shop", "/merchant/products"]) {
      await page.goto(path);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });

  test("mobile-width: hamburger and collapsible layout", async ({ page }) => {
    await page.goto("/shop");
    const width = page.viewportSize()?.width ?? 1280;
    if (width < 768) {
      await expect(page.getByLabel("Open menu")).toBeVisible();
      await expect(page.getByText("Headphones — ANC WFH Pro")).toBeVisible();
      await expect(page.getByRole("button", { name: /Approve & Pay/i })).toBeVisible();
    } else {
      await expect(page.getByRole("link", { name: /AI Commerce/i })).toBeVisible();
    }
  });
});
