import { test, expect } from "@playwright/test";
import { createHmac } from "crypto";

async function createCartWithProduct(request: import("@playwright/test").APIRequestContext) {
  const cartRes = await request.post("/api/cart", { data: {} });
  expect(cartRes.status()).toBe(201);
  const { cart } = await cartRes.json();
  const prodRes = await request.get("/api/products");
  const { products } = await prodRes.json();
  const prod = products.find((p: { inventory: number }) => p.inventory > 5);
  expect(prod).toBeDefined();
  const add = await request.post(`/api/cart/${cart.id}/items`, { data: { productId: prod.id, quantity: 1 } });
  expect(add.status()).toBe(200);
  const addBody = await add.json();
  return { cart: addBody.cart, prod };
}

test.describe("Audit Trail — Phase 8", () => {
  test("GET /api/audit?transactionId returns ordered audit events", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect(approval.status()).toBe(201);
    const { transaction } = await approval.json();
    const checkout = await request.post("/api/checkout/order", { data: { transactionId: transaction.id } });
    expect(checkout.status()).toBe(201);
    const checkoutBody = await checkout.json();
    const paymentId = "pay_audit_e2e_" + Date.now();
    const keySecret = "b5bmHbks6uvVolX7vd3UlKHI";
    const sig = createHmac("sha256", keySecret).update(`${checkoutBody.razorpayOrderId}|${paymentId}`).digest("hex");
    const verify = await request.post("/api/checkout/verify", {
      data: { transactionId: transaction.id, razorpayOrderId: checkoutBody.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sig },
    });
    expect(verify.status()).toBe(200);

    const res = await request.get(`/api/audit?transactionId=${encodeURIComponent(transaction.id)}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(5);
    // Ordered
    for (let i = 1; i < body.events.length; i++) {
      const prev = new Date(body.events[i - 1].timestamp).getTime();
      const cur = new Date(body.events[i].timestamp).getTime();
      expect(prev).toBeLessThanOrEqual(cur);
    }
    // Fields preserved
    for (const e of body.events) {
      expect(e).toHaveProperty("id");
      expect(e).toHaveProperty("eventType");
      expect(e).toHaveProperty("timestamp");
      expect(e).toHaveProperty("isSimulated");
      expect(e).toHaveProperty("verificationSource");
      expect(e.transactionId).toBe(transaction.id);
    }
    // Must not expose secrets
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/RAZORPAY_KEY_SECRET/i);
    expect(raw).not.toMatch(/RAZORPAY_WEBHOOK_SECRET/i);
  });

  test("GET /api/audit?cartId returns ordered events", async ({ request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    expect(approval.status()).toBe(201);

    const res = await request.get(`/api/audit?cartId=${encodeURIComponent(cart.id)}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    for (const e of body.events) expect(e.cartId).toBe(cart.id);
  });

  test("GET /api/audit missing identifiers → 400", async ({ request }) => {
    const res = await request.get("/api/audit");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("GET /api/audit unknown transaction/cart → 200 empty", async ({ request }) => {
    const res1 = await request.get("/api/audit?transactionId=txn_unknown_" + Date.now());
    expect(res1.status()).toBe(200);
    expect((await res1.json()).events.length).toBe(0);
    const res2 = await request.get("/api/audit?cartId=cart_unknown_" + Date.now());
    expect(res2.status()).toBe(200);
    expect((await res2.json()).events.length).toBe(0);
  });

  test("complete flow → merchant audit UI shows events", async ({ page, request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    const { transaction } = await approval.json();
    const checkout = await request.post("/api/checkout/order", { data: { transactionId: transaction.id } });
    const checkoutBody = await checkout.json();
    const paymentId = "pay_ui_" + Date.now();
    const sig = createHmac("sha256", "b5bmHbks6uvVolX7vd3UlKHI").update(`${checkoutBody.razorpayOrderId}|${paymentId}`).digest("hex");
    await request.post("/api/checkout/verify", {
      data: { transactionId: transaction.id, razorpayOrderId: checkoutBody.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sig },
    });

    // Audit API should have events
    const audit = await request.get(`/api/audit?transactionId=${encodeURIComponent(transaction.id)}`);
    const auditBody = await audit.json();
    expect(auditBody.events.length).toBeGreaterThanOrEqual(1);
    const requestId = auditBody.events.find((e: { requestId: string | null }) => e.requestId)?.requestId;

    // Merchant audit page loads and shows lookup, then fetches via UI
    await page.goto(`/merchant/audit?transactionId=${encodeURIComponent(transaction.id)}`);
    await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
    // AuditBrowser should auto-fetch on mount when query present and show table
    await expect(page.getByText(/Timeline/).first()).toBeVisible({ timeout: 8000 });
    // Wait for fetch — table should populate
    await expect(page.getByText(/APPROVAL_GRANTED|STATE_TRANSITION/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/CHECKOUT_ORDER_CREATED|PAYMENT_VERIFIED/).first()).toBeVisible({ timeout: 8000 });
    // requestId should be in the table
    if (requestId) {
      await expect(page.getByText(requestId).first()).toBeVisible({ timeout: 8000 });
    }
  });

  test("merchant orders page shows transaction", async ({ page, request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    const { transaction } = await approval.json();

    await page.goto("/merchant/orders");
    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByText(transaction.id.slice(0, 8)).first()).toBeVisible({ timeout: 8000 });
    // Link to audit
    await expect(page.getByRole("link", { name: "Audit" }).first()).toBeVisible();
  });

  test("merchant payments page shows payment after verify", async ({ page, request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    const { transaction } = await approval.json();
    const checkout = await request.post("/api/checkout/order", { data: { transactionId: transaction.id } });
    const checkoutBody = await checkout.json();
    const paymentId = "pay_payments_" + Date.now();
    const sig = createHmac("sha256", "b5bmHbks6uvVolX7vd3UlKHI").update(`${checkoutBody.razorpayOrderId}|${paymentId}`).digest("hex");
    await request.post("/api/checkout/verify", {
      data: { transactionId: transaction.id, razorpayOrderId: checkoutBody.razorpayOrderId, razorpayPaymentId: paymentId, razorpaySignature: sig },
    });

    await page.goto("/merchant/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByText(transaction.id.slice(0, 8)).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("PAYMENT_SUCCESS").first()).toBeVisible();
  });

  test("merchant audit page manual lookup and orders→audit navigation", async ({ page, request }) => {
    const { cart } = await createCartWithProduct(request);
    const approval = await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    const { transaction } = await approval.json();

    // Go to orders, click Audit button on the table row (not sidebar)
    await page.goto("/merchant/orders");
    await expect(page.getByText(transaction.id.slice(0, 8)).first()).toBeVisible({ timeout: 8000 });
    // Find the row containing the transaction, then click its Audit button
    const row = page.getByRole("row").filter({ hasText: transaction.id.slice(0, 8) }).first();
    const auditLink = row.getByRole("link", { name: "Audit" });
    await auditLink.click();
    await page.waitForURL(/\/merchant\/audit\?transactionId=/);
    await expect(page.getByText(/Timeline/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/APPROVAL|STATE_TRANSITION/).first()).toBeVisible({ timeout: 8000 });
  });

  test("mobile: audit, orders, payments no horizontal overflow", async ({ page, request }) => {
    const { cart } = await createCartWithProduct(request);
    await request.post("/api/approval", { data: { cartId: cart.id, cartHash: cart.hash } });
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ["/merchant/audit", "/merchant/orders", "/merchant/payments"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    }
  });
});
