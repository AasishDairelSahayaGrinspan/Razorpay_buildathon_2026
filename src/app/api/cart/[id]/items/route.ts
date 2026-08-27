import { NextResponse } from "next/server";
import { z } from "zod";
import { CartService } from "@/server/cart";

const ParamsSchema = z.object({ id: z.string().min(1).max(100) });
const BodySchema = z
  .object({
    productId: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(10),
    // Explicitly forbid price injection — if client sends price/total, validation will strip but we reject if present
    unitPrice: z.never().optional(),
    price: z.never().optional(),
    total: z.never().optional(),
  })
  .strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pParsed = ParamsSchema.safeParse({ id });
  if (!pParsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid cart id" } }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  // Detect price injection attempt before strict parse (to give clear error)
  if (body && typeof body === "object" && ("unitPrice" in (body as Record<string, unknown>) || "price" in (body as Record<string, unknown>) || "total" in (body as Record<string, unknown>))) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Client price injection not allowed — price is server-authoritative" } }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message, details: parsed.error.issues } }, { status: 400 });
  }

  try {
    const cart = await CartService.addItem(pParsed.data.id, parsed.data.productId, parsed.data.quantity);
    return NextResponse.json({ cart }, { status: 200 });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code ?? "INTERNAL";
    const status =
      code === "CART_NOT_FOUND"
        ? 404
        : code === "PRODUCT_NOT_FOUND"
          ? 404
          : code === "PRODUCT_INACTIVE" || code === "INSUFFICIENT_INVENTORY" || code === "INVALID_QUANTITY" || code === "CART_FULL" || code === "MERCHANT_MISMATCH"
            ? 400
            : 500;
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}
