import { test, expect } from "@playwright/test";

// =============================================================================
// Phase 10 — Mobile E2E: cross-viewport layout + behavior coverage.
// Tests run under BOTH the mobile (Pixel 7, 375px) project and the desktop
// (1280px) project so we can confirm no-overflow at every breakpoint.
// Each test exercises a real user flow on the current viewport and asserts
// that the horizontal scroll width does not exceed the viewport.
// =============================================================================

const PHONE_VIEWPORT = { width: 375, height: 800 };
const TABLET_VIEWPORT = { width: 768, height: 1024 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.describe("Phase 10 — Mobile/responsive layout", () => {
  for (const vp of [
    { name: "phone (375)", viewport: PHONE_VIEWPORT },
    { name: "tablet (768)", viewport: TABLET_VIEWPORT },
    { name: "desktop (1280)", viewport: DESKTOP_VIEWPORT },
  ]) {
    test.describe(vp.name, () => {
      test.use({ viewport: vp.viewport });

      test(`/shop: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/shop");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/shop with cart: no overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/shop");
        await page.getByRole("button", { name: /Add to cart —/ }).first().click();
        await expect(page.getByText(/Cart • \d+ items/).first()).toBeVisible({ timeout: 8000 });
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/merchant: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/merchant");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/merchant/products: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/merchant/products");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/merchant/orders: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/merchant/orders");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/merchant/payments: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/merchant/payments");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });

      test(`/merchant/audit: no horizontal overflow at ${vp.name}`, async ({ page }) => {
        await page.goto("/merchant/audit");
        await page.waitForTimeout(500);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        const cw = await page.evaluate(() => document.documentElement.clientWidth);
        expect(sw).toBeLessThanOrEqual(cw + 2);
      });
    });
  }
});

test.describe("Phase 10 — Mobile behavior", () => {
  // Phone-only tests
  test.describe("phone (375)", () => {
    test.use({ viewport: PHONE_VIEWPORT });

    test("mobile: hamburger menu opens, navigates to /shop", async ({ page }) => {
      await page.goto("/");
      // / redirects to /shop
      await expect(page).toHaveURL(/\/shop/);
      // Open hamburger
      const menuBtn = page.getByLabel("Open menu");
      await expect(menuBtn).toBeVisible();
      await menuBtn.click();
      // Link appears
      await expect(page.getByRole("link", { name: /AI Commerce/ }).first()).toBeVisible();
    });

    test("mobile: chat input is reachable, sends a message", async ({ page }) => {
      await page.goto("/shop");
      const input = page.getByPlaceholder(/e\.g\. headphones under/i);
      await expect(input).toBeVisible();
      await input.fill("wireless keyboard");
      const ask = page.getByRole("button", { name: "Ask" });
      await expect(ask).toBeEnabled();
      await ask.click();
      // Wait for any agent response (recommendation or "no match")
      await page.waitForTimeout(3000);
      // Cart still empty
      await expect(page.getByText(/Your Cart • 0 items|Cart empty/i).first()).toBeVisible();
    });

    test("mobile: cart add → cart shows 1 item, hash visible", async ({ page }) => {
      await page.goto("/shop");
      await page.getByRole("button", { name: /Add to cart —/ }).first().click();
      await expect(page.getByText(/Cart • 1 items/).first()).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/hash:/i).first()).toBeVisible();
      // No horizontal overflow after add
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const cw = await page.evaluate(() => document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(cw + 2);
    });

    test("mobile: approve → APPROVED, policy shown, no overflow", async ({ page }) => {
      await page.goto("/shop");
      await page.getByRole("button", { name: /Add to cart —/ }).first().click();
      await expect(page.getByText(/Cart • 1 items/).first()).toBeVisible({ timeout: 8000 });
      await page.getByRole("button", { name: "Approve & Pay" }).first().click();
      await expect(page.getByText("APPROVED").first()).toBeVisible({ timeout: 8000 });
      await expect(page.getByText(/Policy: \d+\/12 passed/).first()).toBeVisible();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const cw = await page.evaluate(() => document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(cw + 2);
    });
  });

  // Tablet-only tests
  test.describe("tablet (768)", () => {
    test.use({ viewport: TABLET_VIEWPORT });

    test("tablet: 4-column browse grid still readable", async ({ page }) => {
      await page.goto("/shop");
      // Shop has 4-col on desktop, but on tablet it should still show all products
      await expect(page.getByText("Headphones — ANC WFH Pro")).toBeVisible();
      await expect(page.getByText("USB Microphone — Studio Mini")).toBeVisible();
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      const cw = await page.evaluate(() => document.documentElement.clientWidth);
      expect(sw).toBeLessThanOrEqual(cw + 2);
    });
  });
});
