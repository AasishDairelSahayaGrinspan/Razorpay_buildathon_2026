import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { AuditService } from "@/server/audit/service";
import { transition } from "@/server/transaction/stateMachine";
import type { TransactionStatus } from "@/server/transaction/stateMachine";

// Razorpay SDK — server only
import Razorpay from "razorpay";

type CreateCheckoutOrderResult = {
  transactionId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
};

type VerifyPaymentArgs = {
  transactionId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

type VerifyPaymentResult = {
  transactionId: string;
  status: TransactionStatus;
  razorpayOrderId: string;
  razorpayPaymentId: string;
};

function getRazorpayKeys(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw Object.assign(new Error("Razorpay keys not configured"), {
      code: "RAZORPAY_CONFIG_MISSING",
      status: 500,
    });
  }
  return { keyId, keySecret };
}

function getRazorpayClient(): InstanceType<typeof Razorpay> {
  const { keyId, keySecret } = getRazorpayKeys();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export const CheckoutService = {
  async createCheckoutOrder(transactionId: string): Promise<CreateCheckoutOrderResult> {
    if (!transactionId || typeof transactionId !== "string") {
      throw Object.assign(new Error("transactionId required"), { code: "INVALID_INPUT", status: 400 });
    }

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) {
      throw Object.assign(new Error("Transaction not found"), { code: "TRANSACTION_NOT_FOUND", status: 404 });
    }

    if (txn.status !== "APPROVED") {
      throw Object.assign(new Error(`Transaction status ${txn.status} must be APPROVED to create checkout order`), {
        code: "INVALID_STATE",
        status: 409,
        from: txn.status,
        to: "ORDER_CREATED",
      });
    }

    // Load current cart and verify hash matches approved transaction cartHash
    const cart = await CartService.getCart(txn.cartId);
    if (!cart) {
      throw Object.assign(new Error("Cart not found for transaction"), { code: "CART_NOT_FOUND", status: 404 });
    }

    if (cart.hash !== txn.cartHash) {
      await AuditService.log({
        eventType: "CHECKOUT_REJECTED_STALE_CART",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: txn.status as TransactionStatus,
        toState: null,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: "checkout_create",
      });
      throw Object.assign(
        new Error(`Stale cart: server hash ${cart.hash.slice(0, 8)} vs approved ${txn.cartHash.slice(0, 8)}`),
        { code: "STALE_CART", status: 409 }
      );
    }

    // Use approved snapshot as ONLY source of amount and currency
    let snapshot: { total: number; currency: string };
    try {
      const parsed = JSON.parse(txn.snapshot) as { total: number; currency: string };
      if (typeof parsed.total !== "number" || !Number.isInteger(parsed.total) || typeof parsed.currency !== "string") {
        throw new Error("Invalid snapshot");
      }
      snapshot = parsed;
    } catch {
      throw Object.assign(new Error("Invalid transaction snapshot"), { code: "INVALID_SNAPSHOT", status: 500 });
    }

    const amount = snapshot.total;
    const currency = snapshot.currency;

    // Create Razorpay TEST order using SDK — never accept client-provided amount
    const { keyId } = getRazorpayKeys();
    const client = getRazorpayClient();

    let razorpayOrder: { id: string };
    try {
      // receipt must be unique, max 40 chars — transaction id is cuid (~25 chars)
      const receipt = txn.id.slice(0, 40);
      razorpayOrder = await client.orders.create({
        amount,
        currency,
        receipt,
        notes: {
          transactionId: txn.id,
          cartHash: txn.cartHash,
          merchantId: txn.merchantId,
        },
      });
    } catch (e) {
      await AuditService.log({
        eventType: "CHECKOUT_ORDER_CREATE_FAILED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: txn.status as TransactionStatus,
        toState: null,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: "checkout_create",
      });
      throw Object.assign(new Error(`Razorpay order creation failed: ${(e as Error).message}`), {
        code: "RAZORPAY_ORDER_FAILED",
        status: 502,
        cause: e,
      });
    }

    if (!razorpayOrder || !razorpayOrder.id) {
      throw Object.assign(new Error("Razorpay order creation returned invalid response"), {
        code: "RAZORPAY_ORDER_FAILED",
        status: 502,
      });
    }

    const razorpayOrderId = razorpayOrder.id;

    // Validate transitions before persisting
    transition("APPROVED", "ORDER_CREATED");
    transition("ORDER_CREATED", "PAYMENT_PENDING");

    // Persist razorpayOrderId and transition APPROVED → ORDER_CREATED
    const afterOrderCreated = await prisma.transaction.update({
      where: { id: txn.id },
      data: { razorpayOrderId, status: "ORDER_CREATED" },
    });

    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "APPROVED" as TransactionStatus,
      toState: "ORDER_CREATED" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "checkout_order_created",
    });

    await AuditService.log({
      eventType: "CHECKOUT_ORDER_CREATED",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "APPROVED" as TransactionStatus,
      toState: "ORDER_CREATED" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "razorpay_order",
    });

    // Transition ORDER_CREATED → PAYMENT_PENDING
    await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "PAYMENT_PENDING" },
    });

    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: afterOrderCreated.id,
      cartId: txn.cartId,
      fromState: "ORDER_CREATED" as TransactionStatus,
      toState: "PAYMENT_PENDING" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "checkout_payment_pending",
    });

    // Also log explicit payment pending for audit completeness
    await AuditService.log({
      eventType: "CHECKOUT_PAYMENT_PENDING",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "ORDER_CREATED" as TransactionStatus,
      toState: "PAYMENT_PENDING" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "checkout_create",
    });

    return {
      transactionId: txn.id,
      razorpayOrderId,
      amount,
      currency,
      keyId,
    };
  },

  async verifyPayment(args: VerifyPaymentArgs): Promise<VerifyPaymentResult> {
    const { transactionId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = args;

    if (!transactionId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw Object.assign(new Error("Missing required payment verification fields"), {
        code: "INVALID_INPUT",
        status: 400,
      });
    }

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) {
      throw Object.assign(new Error("Transaction not found"), { code: "TRANSACTION_NOT_FOUND", status: 404 });
    }

    // Handle repeated successful verification idempotently
    if (txn.status === "PAYMENT_SUCCESS") {
      if (txn.razorpayOrderId === razorpayOrderId && txn.razorpayPaymentId === razorpayPaymentId) {
        // Verify signature again even for idempotent path — must still be valid
        const { keySecret } = getRazorpayKeys();
        const message = `${razorpayOrderId}|${razorpayPaymentId}`;
        const expected = createHmac("sha256", keySecret).update(message).digest("hex");
        let sigValid = false;
        if (expected.length === razorpaySignature.length) {
          try {
            sigValid = timingSafeEqual(Buffer.from(expected, "utf-8"), Buffer.from(razorpaySignature, "utf-8"));
          } catch {
            sigValid = false;
          }
        }
        if (!sigValid) {
          await AuditService.log({
            eventType: "PAYMENT_VERIFICATION_FAILED",
            transactionId: txn.id,
            cartId: txn.cartId,
            fromState: txn.status as TransactionStatus,
            toState: null,
            cartHash: txn.cartHash,
            isSimulated: false,
            verificationSource: "payment_verify_idempotent_invalid_sig",
          });
          throw Object.assign(new Error("Invalid payment signature"), { code: "INVALID_SIGNATURE", status: 400 });
        }

        await AuditService.log({
          eventType: "PAYMENT_VERIFICATION_IDEMPOTENT",
          transactionId: txn.id,
          cartId: txn.cartId,
          fromState: "PAYMENT_SUCCESS" as TransactionStatus,
          toState: "PAYMENT_SUCCESS" as TransactionStatus,
          cartHash: txn.cartHash,
          isSimulated: false,
          verificationSource: "payment_verify_idempotent",
        });

        return {
          transactionId: txn.id,
          status: txn.status as TransactionStatus,
          razorpayOrderId: txn.razorpayOrderId!,
          razorpayPaymentId: txn.razorpayPaymentId!,
        };
      }
      // Already success but different payment details — reject
      throw Object.assign(new Error("Transaction already completed with different payment"), {
        code: "ALREADY_SUCCESS",
        status: 409,
      });
    }

    // Require correct payment state — must be PAYMENT_PENDING or PAYMENT_PROCESSING to verify
    if (txn.status !== "PAYMENT_PENDING" && txn.status !== "PAYMENT_PROCESSING") {
      throw Object.assign(new Error(`Transaction status ${txn.status} is not valid for payment verification`), {
        code: "INVALID_STATE",
        status: 409,
        from: txn.status,
      });
    }

    // Verify stored order ID matches
    if (!txn.razorpayOrderId) {
      throw Object.assign(new Error("Transaction has no Razorpay order — cannot verify payment"), {
        code: "ORDER_NOT_CREATED",
        status: 409,
      });
    }

    if (txn.razorpayOrderId !== razorpayOrderId) {
      await AuditService.log({
        eventType: "PAYMENT_VERIFICATION_FAILED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: txn.status as TransactionStatus,
        toState: null,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: "payment_verify_order_mismatch",
      });
      throw Object.assign(new Error("Razorpay order ID mismatch"), { code: "ORDER_MISMATCH", status: 400 });
    }

    // Verify signature server-side using HMAC SHA256
    const { keySecret } = getRazorpayKeys();
    const message = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = createHmac("sha256", keySecret).update(message).digest("hex");

    let signatureValid = false;
    // timingSafeEqual requires equal length buffers
    if (expectedSignature.length === razorpaySignature.length) {
      try {
        signatureValid = timingSafeEqual(
          Buffer.from(expectedSignature, "utf-8"),
          Buffer.from(razorpaySignature, "utf-8")
        );
      } catch {
        signatureValid = false;
      }
    } else {
      signatureValid = false;
    }

    if (!signatureValid) {
      await AuditService.log({
        eventType: "PAYMENT_VERIFICATION_FAILED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: txn.status as TransactionStatus,
        toState: null,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: "payment_verify_invalid_signature",
      });
      // Invalid signatures must never produce PAYMENT_SUCCESS — throw, do not transition
      throw Object.assign(new Error("Invalid payment signature"), { code: "INVALID_SIGNATURE", status: 400 });
    }

    // Signature valid — persist razorpayPaymentId only after validation and transition
    // First transition PAYMENT_PENDING → PAYMENT_PROCESSING if needed
    let currentStatus = txn.status as TransactionStatus;
    if (currentStatus === "PAYMENT_PENDING") {
      transition("PAYMENT_PENDING", "PAYMENT_PROCESSING");
      await prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "PAYMENT_PROCESSING", razorpayPaymentId, paymentStatus: "authorized" },
      });
      await AuditService.log({
        eventType: "STATE_TRANSITION",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: "PAYMENT_PENDING" as TransactionStatus,
        toState: "PAYMENT_PROCESSING" as TransactionStatus,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: "payment_verify_processing",
      });
      currentStatus = "PAYMENT_PROCESSING";
    } else if (currentStatus === "PAYMENT_PROCESSING") {
      // Already processing — ensure paymentId persisted/updated if same signature validated
      // For processing state, we may need to ensure razorpayPaymentId is set
      if (txn.razorpayPaymentId !== razorpayPaymentId) {
        await prisma.transaction.update({
          where: { id: txn.id },
          data: { razorpayPaymentId, paymentStatus: "authorized" },
        });
      }
    }

    // Transition PAYMENT_PROCESSING → PAYMENT_SUCCESS
    transition("PAYMENT_PROCESSING", "PAYMENT_SUCCESS");
    const updated = await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "PAYMENT_SUCCESS", razorpayPaymentId, paymentStatus: "captured" },
    });

    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "PAYMENT_PROCESSING" as TransactionStatus,
      toState: "PAYMENT_SUCCESS" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "payment_verify_success",
    });

    await AuditService.log({
      eventType: "PAYMENT_VERIFIED",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "PAYMENT_PROCESSING" as TransactionStatus,
      toState: "PAYMENT_SUCCESS" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: "hmac_sha256",
    });

    return {
      transactionId: updated.id,
      status: updated.status as TransactionStatus,
      razorpayOrderId: updated.razorpayOrderId!,
      razorpayPaymentId: updated.razorpayPaymentId!,
    };
  },
};
