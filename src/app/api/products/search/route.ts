import { NextResponse } from "next/server";
import { z } from "zod";
import { CatalogService } from "@/server/catalog";

const QuerySchema = z.object({
  query: z.string().max(100).optional(),
  category: z.string().max(50).optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(), // paise
  minPrice: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  activeOnly: z.enum(["true", "false"]).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = {
      query: searchParams.get("query") ?? undefined,
      category: searchParams.get("category") ?? undefined,
      maxPrice: searchParams.get("maxPrice") ?? undefined,
      minPrice: searchParams.get("minPrice") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      activeOnly: searchParams.get("activeOnly") ?? undefined,
    };

    const parsed = QuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message, details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const { query, category, maxPrice, minPrice, limit, activeOnly } = parsed.data;

    if (maxPrice !== undefined && minPrice !== undefined && minPrice > maxPrice) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "minPrice cannot exceed maxPrice" } }, { status: 400 });
    }

    const products = await CatalogService.searchProducts({
      query: query?.trim() || undefined,
      category: category?.trim() || undefined,
      maxPrice,
      minPrice,
      limit: limit ?? 20,
      activeOnly: activeOnly ? activeOnly === "true" : true,
    });

    const api = products.map((p) => CatalogService.toApi(p));
    return NextResponse.json({ products: api, count: api.length, query: query ?? null }, { status: 200 });
  } catch (e) {
    console.error("[GET /api/products/search]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Search failed" } }, { status: 500 });
  }
}
