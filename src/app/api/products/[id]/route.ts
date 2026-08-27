import { NextResponse } from "next/server";
import { z } from "zod";
import { CatalogService } from "@/server/catalog";

const ParamsSchema = z.object({ id: z.string().min(1).max(100) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const parsed = ParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid product id" } }, { status: 400 });
    }

    const product = await CatalogService.getProduct(parsed.data.id);
    if (!product) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Product not found" } }, { status: 404 });
    }

    return NextResponse.json({ product: CatalogService.toApi(product) }, { status: 200 });
  } catch (e) {
    console.error("[GET /api/products/:id]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Failed to fetch product" } }, { status: 500 });
  }
}
