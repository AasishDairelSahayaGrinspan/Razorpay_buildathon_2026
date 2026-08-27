import { NextResponse } from "next/server";
import { z } from "zod";
import { CatalogService } from "@/server/catalog";

const ParamsSchema = z.object({ id: z.string().min(1).max(100) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = (await params) as { id: string };
    const parsed = ParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid product id" } }, { status: 400 });
    }

    const result = await CatalogService.checkAvailability(parsed.data.id);
    if (!result.exists) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Product not found" } }, { status: 404 });
    }

    return NextResponse.json(
      {
        productId: parsed.data.id,
        exists: result.exists,
        active: result.active,
        inventory: result.inventory,
        available: result.available,
        product: result.product ? CatalogService.toApi(result.product) : null,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("[GET /api/products/:id/availability]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Availability check failed" } }, { status: 500 });
  }
}
