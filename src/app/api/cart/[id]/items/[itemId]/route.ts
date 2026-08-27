import { NextResponse } from "next/server";
import { z } from "zod";
import { CartService } from "@/server/cart";

const ParamsSchema = z.object({ id: z.string().min(1).max(100), itemId: z.string().min(1).max(100) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const p = await params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid ids" } }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  if (body && typeof body === "object" && ("unitPrice" in (body as Record<string, unknown>) || "price" in (body as Record<string, unknown>))) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Client price injection not allowed" } }, { status: 400 });
  }

  const BodySchema = z.object({ quantity: z.number().int().min(1).max(10) }).strict();
  const bParsed = BodySchema.safeParse(body);
  if (!bParsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: bParsed.error.issues[0].message } }, { status: 400 });
  }

  try {
    const cart = await CartService.updateItemQuantity(parsed.data.id, parsed.data.itemId, bParsed.data.quantity);
    return NextResponse.json({ cart }, { status: 200 });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code ?? "INTERNAL";
    const status = code === "CART_NOT_FOUND" || code === "ITEM_NOT_FOUND" || code === "PRODUCT_NOT_FOUND" ? 404 : code === "INVALID_QUANTITY" || code === "INSUFFICIENT_INVENTORY" || code === "PRODUCT_INACTIVE" ? 400 : 500;
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const p = await params;
  const parsed = ParamsSchema.safeParse(p);
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid ids" } }, { status: 400 });

  try {
    const cart = await CartService.removeItem(parsed.data.id, parsed.data.itemId);
    return NextResponse.json({ cart }, { status: 200 });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code ?? "INTERNAL";
    const status = code === "CART_NOT_FOUND" || code === "ITEM_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}
