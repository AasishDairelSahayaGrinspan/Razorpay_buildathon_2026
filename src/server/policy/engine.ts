import { CartService } from "../cart";
import { CatalogService } from "../catalog";
import type { PolicyCheck, PolicyResult } from "./types";
import { check, SUPPORTED_CURRENCIES } from "./checks";

export const PolicyEngine = {
  async evaluate(cartId: string, clientCartHash: string): Promise<PolicyResult> {
    const cart = await CartService.getCart(cartId);
    const checks: PolicyCheck[] = [];

    // 1. cart exists
    checks.push(check("cart_exists", "Cart exists", !!cart, cart ? "Cart found" : "Cart not found"));
    if (!cart) {
      return { passed: checks.filter((c) => c.passed).length, total: 12, checks: await completeChecks(checks), approved: false };
    }

    // Load products map for checks
    const products = new Map<string, { id: string; price: number; currency: string; active: boolean; inventory: number; merchantId: string }>();
    for (const item of cart.items) {
      const prod = await CatalogService.getProduct(item.productId);
      if (prod) products.set(item.productId, { id: prod.id, price: prod.price, currency: prod.currency, active: prod.active, inventory: prod.inventory, merchantId: prod.merchantId });
    }

    // 2. cart is not empty
    checks.push(check("cart_not_empty", "Cart not empty", cart.items.length > 0, cart.items.length > 0 ? `${cart.items.length} items` : "Cart empty"));

    // 3. cart is ACTIVE
    checks.push(check("cart_active", "Cart is ACTIVE", cart.status === "ACTIVE", cart.status === "ACTIVE" ? "ACTIVE" : `Status ${cart.status}`));

    // 4. cartHash matches (server recalculated vs client)
    const hashMatches = cart.hash === clientCartHash;
    checks.push(check("cartHash_matches", "Cart hash matches", hashMatches, hashMatches ? "Hash matches" : `Stale cart: client ${clientCartHash.slice(0, 8)} vs server ${cart.hash.slice(0, 8)}`));

    // 5. merchant ownership matches
    const merchantOk = cart.items.every((it) => {
      const p = products.get(it.productId);
      return p ? p.merchantId === cart.merchantId : false;
    });
    // Also cart merchant vs products
    checks.push(check("merchant_ownership", "Merchant ownership matches", merchantOk && cart.merchantId === "merchant_demo", merchantOk ? "Merchant matches" : "Merchant mismatch"));

    // 6. currency is supported
    const currencyOk = SUPPORTED_CURRENCIES.includes(cart.currency) && cart.items.every((it) => SUPPORTED_CURRENCIES.includes(it.currency));
    checks.push(check("currency_supported", "Currency supported", currencyOk, currencyOk ? cart.currency : `Unsupported ${cart.currency}`));

    // 7. products still exist
    const productsExist = cart.items.every((it) => products.has(it.productId));
    checks.push(check("products_exist", "Products exist", productsExist, productsExist ? "All products found" : "Some products missing"));

    // 8. products are active
    const productsActive = cart.items.every((it) => {
      const p = products.get(it.productId);
      return p ? p.active : false;
    });
    checks.push(check("products_active", "Products active", productsActive, productsActive ? "All active" : "Some inactive"));

    // 9. inventory is sufficient
    const inventoryOk = cart.items.every((it) => {
      const p = products.get(it.productId);
      return p ? p.inventory >= it.quantity : false;
    });
    checks.push(check("inventory_sufficient", "Inventory sufficient", inventoryOk, inventoryOk ? "Inventory ok" : "Insufficient inventory"));

    // 10. prices are authoritative (unitPrice equals current Product.price)
    const pricesOk = cart.items.every((it) => {
      const p = products.get(it.productId);
      return p ? p.price === it.unitPrice : false;
    });
    checks.push(check("prices_authoritative", "Prices authoritative", pricesOk, pricesOk ? "Prices match DB" : "Price mismatch — stale snapshot"));

    // 11. totals are deterministic (sum unitPrice*qty === cart totals)
    const expectedTotal = cart.items.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
    const totalsOk = expectedTotal === cart.totals.total && expectedTotal === cart.totals.subtotal;
    checks.push(check("totals_deterministic", "Totals deterministic", totalsOk, totalsOk ? `Total ${expectedTotal} paise` : `Expected ${expectedTotal}, got ${cart.totals.total}`));

    // 12. quantity bounds valid (1-10, integer)
    const qtyOk = cart.items.every((it) => Number.isInteger(it.quantity) && it.quantity >= 1 && it.quantity <= 10);
    checks.push(check("quantity_bounds", "Quantity bounds valid", qtyOk, qtyOk ? "Quantities 1-10" : "Invalid quantity"));

    // Ensure we always have 12 checks (pad if needed, but we have 12)
    const completed = await completeChecks(checks);
    const passed = completed.filter((c) => c.passed).length;
    const approved = passed === completed.length;

    return { passed, total: completed.length, checks: completed, approved };
  },
};

async function completeChecks(checks: PolicyCheck[]): Promise<PolicyCheck[]> {
  // Ensure 12 checks — if early return had only 1, pad with failed others for total consistency
  if (checks.length < 12) {
    const missing = 12 - checks.length;
    for (let i = 0; i < missing; i++) {
      checks.push(check(`missing_${i}`, `Missing check ${i}`, false, "Cart not loaded — dependent checks failed"));
    }
  }
  return checks.slice(0, 12);
}
