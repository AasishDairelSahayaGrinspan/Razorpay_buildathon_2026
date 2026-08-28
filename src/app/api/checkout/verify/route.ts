import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckoutService } from "@/server/checkout/service";

export const dynamic = "force-dynamic";

const BodySchema = z
  .object({
    transactionId: z.string().min(1).max(100),
    razorpayOrderId: z.string().min(1).max(100),
    razorpayPaymentId: z.string().min(1).max(100),
    razorpaySignature: z.string().min(1).max(200),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const forbidden = ["amount", "total", "currency", "price", "unitPrice", "keyId", "keySecret"];
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
    const result = await CheckoutService.verifyPayment({
      transactionId: parsed.data.transactionId,
      razorpayOrderId: parsed.data.razorpayOrderId,
      razorpayPaymentId: parsed.data.razorpayPaymentId,
      razorpaySignature: parsed.data.razorpaySignature,
    });

    return NextResponse.json(
      {
        transactionId: result.transactionId,
        status: result.status,
        razorpayOrderId: result.razorpayOrderId,
        razorpayPaymentId: result.razorpayPaymentId,
      },
      { status: 200 }
    );
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    const code = err.code ?? "INTERNAL";
    let status = err.status ?? 500;
    if (!err.status) {
      if (code === "INVALID_SIGNATURE") status = 400;
      else if (code === "ORDER_MISMATCH") status = 400;
      else if (code === "INVALID_STATE") status = 409;
      else if (code === "TRANSACTION_NOT_FOUND" || code === "ORDER_NOT_CREATED") status = 404;
      else if (code === "INVALID_INPUT") status = 400;
      else if (code === "ALREADY_SUCCESS") status = 409;
      else status = 500;
    }
    // Invalid signature must NEVER produce PAYMENT_SUCCESS — we throw, client never gets success
    return NextResponse.json({ error: { code, message: err.message } }, { status });
  }
}

export async function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" } }, { status: 405 });
}
