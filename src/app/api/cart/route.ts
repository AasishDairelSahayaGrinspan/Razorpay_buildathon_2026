import { NextResponse } from "next/server";
import { z } from "zod";
import { CartService } from "@/server/cart";

const CreateSchema = z.object({
  merchantId: z.string().max(100).optional(),
  currency: z.string().length(3).optional(),
});

export async function POST(request: Request) {
  try {
    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } }, { status: 400 });
    }
    const cart = await CartService.createCart(parsed.data);
    return NextResponse.json({ cart }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/cart]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Failed to create cart" } }, { status: 500 });
  }
}
