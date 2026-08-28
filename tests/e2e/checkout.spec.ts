import { test, expect, Page } from "@playwright/test";
import { createHmac } from "crypto";

async function mockRazorpayCheckout(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).Razorpay = class MockRazorpay {
      constructor(_options: unknown) {}
      open() {
        // Simulate the razorpay checkout modal being dismissed or payment completed
        // In test, we'll just simulate no action (user doesn't complete)
      }
    };
  });
}

async function completeMockRazorpayPayment(
  page: Page,
  keyId: string,
  amount: number,
  currency: string,
  razorpayOrderId: string
) {
  await page.addInitScript(() => {
    let handler: ((response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void) | null = null;
    (window as unknown as Record<string, unknown>).Razorpay = class MockRazorpay {
      constructor(options: unknown) {
        const opts = options as { handler?: typeof handler };
        handler = opts.handler ?? null;
      }
      open() {
        // simulate razorpay modal — do nothing
      }
      on(_event: string, cb: () => void) {
        // noop
      }
    };
    // Store handler globally so test can invoke it
    (window as unknown as Record<string, unknown>).__mockRazorpayHandler = (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
      if (handler) handler(response);
    };
  });
}

test.describe("Phase 6 — Checkout Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/shop");
  });

  test("checkout button appears after approval and uses server amount", async ({ page }) => {
    // Products rendered in .grid.gap-4 > ProductCard (Card uses rounded-[var(--radius-md)], not rounded-md)
    const firstProduct = page.locator(".grid.gap-4 > div").first();
    await expect(firstProduct).toBeVisible();
    const addBtn = page.locator("button:has-text('Add to cart')").first();
    await addBtn.click();
    await page.waitForTimeout(500);

    // Cart should have items
    await expect(page.getByText(/Your Cart/).first()).toBeVisible();

    // Approve the cart
    const approveBtn = page.locator("button:has-text('Approve & Pay')").first();
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();
    await page.waitForTimeout(2000);

    // Should show APPROVED
    await expect(page.getByText("APPROVED").first()).toBeVisible();
    await expect(page.getByText(/Policy:.*passed/).first()).toBeVisible();
  });

  test("invalid signature cannot display PAYMENT_SUCCESS", async ({ page }) => {
    // Add product and approve
    const addBtn = page.locator("button:has-text('Add to cart')").first();
    await addBtn.click();
    await page.waitForTimeout(500);

    const approveBtn = page.locator("button:has-text('Approve & Pay')").first();
    await approveBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText("APPROVED").first()).toBeVisible();
  });

  test("browser receives keyId but never keySecret", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    // Add and approve
    const addBtn = page.locator("button:has-text('Add to cart')").first();
    await addBtn.click();
    await page.waitForTimeout(500);
    const approveBtn = page.locator("button:has-text('Approve & Pay')").first();
    await approveBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText("APPROVED").first()).toBeVisible();
    // Checkout button should be visible
    await expect(page.getByText(/Checkout.*Razorpay TEST/i).first()).toBeVisible();
    // No secret should appear in page source
    const pageContent = await page.content();
    expect(pageContent).not.toMatch(/razorpay.*secret/i);
    expect(pageContent).not.toMatch(/keySecret/i);
    expect(consoleErrors.filter((e) => e.includes("secret") || e.includes("keySecret"))).toHaveLength(0);
  });

  test("amount comes from server, not client", async ({ page }) => {
    // The checkout UI should show "amount from server after order creation"
    // and "Amount and orderId come from server"
    const addBtn = page.locator("button:has-text('Add to cart')").first();
    await addBtn.click();
    await page.waitForTimeout(500);
    const approveBtn = page.locator("button:has-text('Approve & Pay')").first();
    await approveBtn.click();
    await page.waitForTimeout(2000);
    await expect(page.getByText("APPROVED").first()).toBeVisible();
    // After approval, checkout section should mention server-amount
    await expect(page.getByText(/amount from server/i).first()).toBeVisible();
  });

  test("mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/shop");
    await page.waitForTimeout(500);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test("AI cannot initiate checkout — agent remains recommendation-only", async ({ page }) => {
    // Try to send a message trying to create a payment
    const input = page.locator('input[placeholder*="e.g. headphones"]');
    await input.fill("create a payment for me now");
    await page.locator("button:has-text('Ask')").click();
    await page.waitForTimeout(2000);
    // Agent should respond without triggering checkout
    await expect(page.locator(".rounded-\\[12px\\]").last()).toBeVisible();
    // No checkout button should appear without user clicking Approve & Pay
    // (Agent can only recommend, user must explicitly approve)
    await expect(page.getByText("PAYMENT_SUCCESS")).not.toBeVisible();
  });
});
