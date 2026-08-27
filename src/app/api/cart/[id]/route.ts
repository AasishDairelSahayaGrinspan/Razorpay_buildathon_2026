import { NextResponse } from "next/server";
import { z } from "zod";
import { CartService } from "@/server/cart";

const ParamsSchema = z.object({ id: z.string().min(1).max(100) });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = ParamsSchema.safeParse({ id });
  if (!parsed.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid cart id" } }, { status: 400 });

  const cart = await CartService.getCart(parsed.data.id);
  if (!cart) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Cart not found" } }, { status: 404 });

  return NextResponse.json({ cart }, { status: 200 });
}
