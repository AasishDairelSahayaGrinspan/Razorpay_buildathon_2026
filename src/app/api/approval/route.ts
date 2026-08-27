import { NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalService } from "@/server/approval/service";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    cartId: z.string().min(1).max(100),
    cartHash: z.string().min(1).max(100),
    // Forbid price/total injection
    price: z.never().optional(),
    total: z.never().optional(),
    unitPrice: z.never().optional(),
    currency: z.never().optional(),
    merchantId: z.never().optional(),
    inventory: z.never().optional(),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  // Explicit injection check
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if ("price" in b || "total" in b || "unitPrice" in b || "currency" in b || "merchantId" in b || "inventory" in b) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Client price/currency/merchant injection not allowed" } },
        { status: 400 }
      );
    }
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message, details: parsed.error.issues } }, { status: 400 });
  }

  const requestId = request.headers.get("x-request-id") ?? `req_${Date.now().toString(36)}`;

  try {
    const result = await ApprovalService.approve(parsed.data.cartId, parsed.data.cartHash, requestId);
    return NextResponse.json(
      {
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          cartId: result.transaction.cartId,
          cartHash: result.transaction.cartHash,
          total: result.transaction.total,
          currency: result.transaction.currency,
        },
        policy: {
          passed: result.policy.passed,
          total: result.policy.total,
          checks: result.policy.checks,
        },
        isIdempotent: result.isIdempotent ?? false,
      },
      { status: result.isIdempotent ? 200 : 201 }
    );
  } catch (e) {
    const err = e as Error & { code?: string; status?: number; policy?: unknown; transaction?: unknown };
    const code = err.code ?? "INTERNAL";
    const status = err.status ?? (code === "STALE_CART" ? 409 : code === "POLICY_FAILED" ? 400 : code === "CART_NOT_FOUND" ? 404 : 500);
    // Policy failure should include policy details
    if (code === "POLICY_FAILED" && err.policy) {
      return NextResponse.json({ error: { code, message: err.message }, policy: err.policy, transaction: err.transaction ?? null }, { status });
    }
    if (code === "STALE_CART") {
      return NextResponse.json({ error: { code, message: err.message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}
