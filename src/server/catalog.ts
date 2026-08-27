import { prisma } from "@/lib/prisma";
import type { Product } from "@/generated/prisma/client";

/**
 * CatalogService — server-only
 * UI → API → CatalogService → DB
 * No DB access from client components, no AI direct DB.
 */
export const CatalogService = {
  /**
   * List products, default activeOnly=true
   */
  async listProducts(opts?: { activeOnly?: boolean; merchantId?: string }): Promise<Product[]> {
    const activeOnly = opts?.activeOnly ?? true;
    return prisma.product.findMany({
      where: {
        ...(activeOnly ? { active: true } : {}),
        ...(opts?.merchantId ? { merchantId: opts.merchantId } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  },

  async getProduct(id: string): Promise<Product | null> {
    if (!id || typeof id !== "string") return null;
    return prisma.product.findUnique({ where: { id } });
  },

  /**
   * Search with deterministic rules: query matches name/description/tags, category exact, price range.
   * Never invents prices — returns DB prices.
   */
  async searchProducts(params: {
    query?: string;
    category?: string;
    maxPrice?: number; // paise
    minPrice?: number;
    activeOnly?: boolean;
    limit?: number;
  }): Promise<Product[]> {
    const { query, category, maxPrice, minPrice, activeOnly = true, limit = 20 } = params;

    const where: Record<string, unknown> = {};
    if (activeOnly) (where as { active: boolean }).active = true;
    if (category) (where as { category: string }).category = category;
    if (typeof maxPrice === "number") (where as { price: { lte: number } }).price = { ...(where as { price: object }).price, lte: maxPrice };
    if (typeof minPrice === "number") (where as { price: { gte: number } }).price = { ...(where as { price: object }).price, gte: minPrice };

    // Query filter: we'll fetch then filter for sqlite LIKE, or use contains if supported
    // For sqlite, Prisma contains is case-insensitive if mode insensitive but we do manual for reliability
    const products = await prisma.product.findMany({
      where: where as never,
      orderBy: { price: "asc" },
      take: query ? 100 : limit, // fetch more if we need to filter by query
    });

    if (!query) return products.slice(0, limit);

    const q = query.toLowerCase().trim();
    // Token-based matching: split query into words, match any token (len>2) in hay
    const tokens = q
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2);
    const filtered = products
      .map((p) => {
        const hay = `${p.name} ${p.description} ${p.tags ?? ""} ${p.category}`.toLowerCase();
        // Count matching tokens for ranking
        const score = tokens.reduce((acc, tok) => acc + (hay.includes(tok) ? 1 : 0), 0);
        // Also bonus if full query substring matches (exact phrase)
        const exactBonus = hay.includes(q) ? 2 : 0;
        return { p, score: score + exactBonus };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.p.price - b.p.price;
      })
      .map(({ p }) => p);
    // If no token matches, return empty to allow fallback logic in agent
    return filtered.slice(0, limit);
  },

  /**
   * Check availability: active + inventory > 0
   */
  async checkAvailability(id: string): Promise<{ exists: boolean; active: boolean; inventory: number; available: boolean; product: Product | null }> {
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return { exists: false, active: false, inventory: 0, available: false, product: null };
    const available = product.active && product.inventory > 0;
    return { exists: true, active: product.active, inventory: product.inventory, available, product };
  },

  /**
   * Format for API — ensure price is integer paise
   */
  toApi(product: Product) {
    return {
      id: product.id,
      merchantId: product.merchantId,
      name: product.name,
      description: product.description,
      category: product.category,
      price: product.price,
      currency: product.currency,
      image: product.image,
      inventory: product.inventory,
      active: product.active,
      tags: product.tags,
      features: product.features ? safeParseJson(product.features) : [],
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      // Derived
      available: product.active && product.inventory > 0,
      priceDisplay: `₹${(product.price / 100).toLocaleString("en-IN")}`,
    };
  },
};

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

export type ApiProduct = ReturnType<typeof CatalogService.toApi>;
