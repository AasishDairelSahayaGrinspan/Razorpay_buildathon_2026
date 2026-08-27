import { CatalogService } from "@/server/catalog";
import {
  SearchCatalogInput,
  GetProductInput,
  GetAvailabilityInput,
  RecommendProductsInput,
  RecommendUpsellInput,
  RecommendCrossSellInput,
  ExplainRecommendationInput,
  CalculateCartPreviewInput,
} from "./schemas";

/**
 * Allowlisted read-only catalog tools — no Razorpay, no checkout, no Prisma direct in caller
 * Every tool validates input, calls CatalogService, returns server-derived data
 */

export const agentTools = {
  async search_catalog(input: unknown) {
    const parsed = SearchCatalogInput.parse(input);
    const products = await CatalogService.searchProducts({
      query: parsed.query,
      category: parsed.category,
      minPrice: parsed.minPrice,
      maxPrice: parsed.maxPrice,
      limit: parsed.limit ?? 5,
      activeOnly: true,
    });
    // Return minimal server-derived fields — price authoritative
    return products.map((p) => CatalogService.toApi(p));
  },

  async get_product(input: unknown) {
    const { productId } = GetProductInput.parse(input);
    const product = await CatalogService.getProduct(productId);
    if (!product) throw new Error(`Product not found: ${productId}`);
    return CatalogService.toApi(product);
  },

  async get_product_availability(input: unknown) {
    const { productId } = GetAvailabilityInput.parse(input);
    const result = await CatalogService.checkAvailability(productId);
    if (!result.exists) throw new Error(`Product not found: ${productId}`);
    return {
      productId,
      active: result.active,
      inventory: result.inventory,
      available: result.available,
    };
  },

  async recommend_products(input: unknown) {
    const parsed = RecommendProductsInput.parse(input);
    // Deterministic: search by intent + budget/category, rank by relevance
    const query = parsed.intent.slice(0, 100);
    const products = await CatalogService.searchProducts({
      query,
      category: parsed.category,
      maxPrice: parsed.budgetPaise,
      limit: parsed.limit ?? 3,
      activeOnly: true,
    });

    // Also try budget-only search if intent yields nothing
    let ranked = products;
    if (ranked.length === 0 && parsed.budgetPaise !== undefined) {
      ranked = await CatalogService.searchProducts({
        maxPrice: parsed.budgetPaise,
        limit: parsed.limit ?? 3,
        activeOnly: true,
      });
    }
    // Fallback to general active list
    if (ranked.length === 0) {
      ranked = await CatalogService.searchProducts({ limit: parsed.limit ?? 3, activeOnly: true });
    }

    // Filter to only include products that actually satisfy constraints
    // Budget filter already applied via DB, but ensure
    if (parsed.budgetPaise !== undefined) {
      ranked = ranked.filter((p) => p.price <= parsed.budgetPaise!);
    }

    return ranked.slice(0, parsed.limit ?? 3).map((p) => ({
      productId: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      currency: p.currency,
      available: p.active && p.inventory > 0,
    }));
  },

  async recommend_upsell(input: unknown) {
    const { primaryProductId } = RecommendUpsellInput.parse(input);
    const primary = await CatalogService.getProduct(primaryProductId);
    if (!primary) throw new Error(`Primary product not found: ${primaryProductId}`);

    // Simple rule: complementary categories
    // Headphones/Audio → Microphone, Webcam → Hub/Stand, Keyboard → Mouse, etc.
    const complementMap: Record<string, string[]> = {
      Audio: ["Audio", "Peripherals"],
      Peripherals: ["Accessories", "Peripherals"],
      Accessories: ["Peripherals", "Accessories"],
    };
    const targetCats = complementMap[primary.category] ?? ["Accessories"];

    for (const cat of targetCats) {
      const candidates = await CatalogService.searchProducts({
        category: cat,
        limit: 5,
        activeOnly: true,
      });
      // Exclude primary, pick cheapest available not same product, inventory>0
      const upsell = candidates.find((p) => p.id !== primary.id && p.active && p.inventory > 0 && p.price < primary.price * 1.5);
      if (upsell) {
        return {
          productId: upsell.id,
          name: upsell.name,
          price: upsell.price,
          currency: upsell.currency,
          category: upsell.category,
          available: true,
          relationship: `complements ${primary.category}`,
        };
      }
    }
    return null; // no upsell available is valid
  },

  async recommend_cross_sell(input: unknown) {
    const parsed = RecommendCrossSellInput.parse(input);
    const primary = await CatalogService.getProduct(parsed.primaryProductId);
    if (!primary) throw new Error(`Primary product not found: ${parsed.primaryProductId}`);

    // Cross-sell: same workflow as upsell but returns up to limit
    const candidates = await CatalogService.searchProducts({
      category: primary.category === "Audio" ? "Peripherals" : "Accessories",
      limit: 10,
      activeOnly: true,
    });
    const filtered = candidates
      .filter((p) => p.id !== primary.id && p.active && p.inventory > 0)
      .slice(0, parsed.limit ?? 2)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
        category: p.category,
        available: true,
      }));
    return filtered;
  },

  async explain_recommendation(input: unknown) {
    const { productId, intent } = ExplainRecommendationInput.parse(input);
    const product = await CatalogService.getProduct(productId);
    if (!product) throw new Error(`Product not found: ${productId}`);
    const api = CatalogService.toApi(product);
    // Build explanation ONLY from actual attributes
    const reasons: string[] = [];
    if (intent) reasons.push(`Matches your request: "${intent.slice(0, 80)}"`);
    reasons.push(`Category: ${api.category}`);
    reasons.push(`Price: ${api.priceDisplay} — server authoritative`);
    if (api.inventory > 10) reasons.push("In stock");
    else if (api.inventory > 0) reasons.push(`Only ${api.inventory} left`);
    if (api.features && Array.isArray(api.features) && api.features.length > 0) {
      const feats = (api.features as string[]).slice(0, 2).join(", ");
      reasons.push(`Features: ${feats}`);
    }
    if (!api.available) reasons.push("Currently unavailable");
    return { productId, name: api.name, reasons, available: api.available, price: api.price, currency: api.currency };
  },

  async calculate_cart_preview(input: unknown) {
    const { items } = CalculateCartPreviewInput.parse(input);
    // Read-only preview: resolve each productId server-side, calculate total paise
    let totalPaise = 0;
    const resolved: { productId: string; name: string; unitPrice: number; quantity: number; subtotal: number; currency: string; available: boolean }[] = [];
    for (const { productId, quantity } of items) {
      const product = await CatalogService.getProduct(productId);
      if (!product) throw new Error(`Product not found: ${productId}`);
      if (!product.active) throw new Error(`Product inactive: ${productId}`);
      if (product.inventory < quantity) throw new Error(`Insufficient inventory for ${product.name}`);
      const subtotal = product.price * quantity;
      totalPaise += subtotal;
      resolved.push({
        productId,
        name: product.name,
        unitPrice: product.price,
        quantity,
        subtotal,
        currency: product.currency,
        available: product.active && product.inventory >= quantity,
      });
    }
    // No mutation, just preview
    return { items: resolved, totalPaise, currency: resolved[0]?.currency ?? "INR", totalDisplay: `₹${(totalPaise / 100).toLocaleString("en-IN")}` };
  },
} as const;

export type AgentToolName = keyof typeof agentTools;
