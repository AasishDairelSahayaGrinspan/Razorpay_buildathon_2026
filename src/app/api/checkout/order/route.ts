import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckoutService } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    transactionId: z.string().min(1).max(100),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  // Explicit injection check — reject client-supplied amount/currency/order fields
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const forbidden = [
      "amount",
      "total",
      "currency",
      "razorpayOrderId",
      "razorpayPaymentId",
      "razorpaySignature",
      "orderId",
      "price",
      "unitPrice",
      "keyId",
      "keySecret",
    ];
    for (const key of forbidden) {
      if (key in b) {
        return NextResponse.json(
          { error: { code: "VALIDATION_ERROR", message: `Field not allowed: ${key}` } },
          { status: 400 }
        );
      }
    }
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message, details: parsed.error.issues } },
      { status: 400 }
    );
  }

  try {
    const result = await CheckoutService.createCheckoutOrder(parsed.data.transactionId);
    // Never expose secret — CheckoutService only returns keyId
    return NextResponse.json(
      {
        transactionId: result.transactionId,
        razorpayOrderId: result.razorpayOrderId,
        amount: result.amount,
        currency: result.currency,
        keyId: result.keyId,
      },
      { status: 201 }
    );
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    const code = err.code ?? "INTERNAL";
    let status = err.status ?? 500;
    // Map known codes to HTTP status if not already set
    if (!err.status) {
      if (code === "STALE_CART") status = 409;
      else if (code === "INVALID_STATE") status = 409;
      else if (code === "TRANSACTION_NOT_FOUND" || code === "CART_NOT_FOUND") status = 404;
      else if (code === "INVALID_INPUT" || code === "VALIDATION_ERROR") status = 400;
      else if (code === "RAZORPAY_ORDER_FAILED") status = 502;
      else if (code === "RAZORPAY_CONFIG_MISSING") status = 500;
      else status = 500;
    }
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}

// Only POST allowed
export async function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
}
