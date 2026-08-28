import { NextResponse } from "next/server";
import { AuditService } from "@/server/audit/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const QuerySchema = z
  .object({
    transactionId: z.string().min(1).max(100).optional(),
    cartId: z.string().min(1).max(100).optional(),
  })
  .refine((v) => !!v.transactionId || !!v.cartId, {
    message: "transactionId or cartId required",
  });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const transactionId = searchParams.get("transactionId") ?? undefined;
  const cartId = searchParams.get("cartId") ?? undefined;

  const parsed = QuerySchema.safeParse({ transactionId, cartId });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message, details: parsed.error.issues } },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.transactionId) {
      const events = await AuditService.listByTransaction(parsed.data.transactionId);
      return NextResponse.json({ events }, { status: 200 });
    }
    if (parsed.data.cartId) {
      const events = await AuditService.listByCart(parsed.data.cartId);
      return NextResponse.json({ events }, { status: 200 });
    }
    // Should not reach here due to refine
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "transactionId or cartId required" } }, { status: 400 });
  } catch (e) {
    console.error("[GET /api/audit]", e);
    return NextResponse.json({ error: { code: "INTERNAL", message: "Failed to fetch audit events" } }, { status: 500 });
  }
}

// Only GET allowed
export async function POST() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } }, { status: 405 });
}
