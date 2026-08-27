import { NextResponse } from "next/server";
import { z } from "zod";
import { CatalogService } from "@/server/catalog";

const QuerySchema = z.object({
  activeOnly: z.enum(["true", "false"]).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = QuerySchema.safeParse({
      activeOnly: searchParams.get("activeOnly") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message } }, { status: 400 });
    }

    const activeOnly = parsed.data.activeOnly ? parsed.data.activeOnly === "true" : true;
    const products = await CatalogService.listProducts({ activeOnly });
    const api = products.map((p) => CatalogService.toApi(p));

    return NextResponse.json({ products: api, count: api.length }, { status: 200 });
  } catch (e) {
    console.error("[GET /api/products]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Failed to list products" } }, { status: 500 });
  }
}
