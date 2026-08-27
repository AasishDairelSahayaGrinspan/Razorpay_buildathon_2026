import { NextResponse } from "next/server";
import { z } from "zod";
import { CartService } from "@/server/cart";

const ParamsSchema = z.object({ id: z.string().min(1).max(100) });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = ParamsSchema.safeParse({ id });
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid cart id" } }, { status: 400 });

  try {
    const cart = await CartService.clearCart(parsed.data.id);
    return NextResponse.json({ cart }, { status: 200 });
  } catch (e) {
    const err = e as Error & { code?: string };
    const code = err.code ?? "INTERNAL";
    const status = code === "CART_NOT_FOUND" ? 404 : 500;
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}
