import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { CartService } from "@/server/cart";
import { AuditService } from "@/server/audit/service";
import { transition, canTransition } from "@/server/transaction/stateMachine";
import type { TransactionStatus } from "@/server/transaction/stateMachine";
import { getRazorpayClient, type RazorpayClient } from "@/server/razorpay/client";

// Phase 9: retry configuration for transient Razorpay order-creation failures.
// Exactly ONE retry with a small bounded backoff — no unbounded loops, no retry on
// validation errors (raised before this point). Failure classification:
//   - transient: network errors, 5xx, timeouts → retry once
//   - non-transient: 4xx (validation/duplicate/config) → do NOT retry
//   - unknown / partial: do NOT retry, surface as RAZORPAY_ORDER_FAILED
const RETRY_BACKOFF_MS = 250;
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

function classifyError(e: unknown): { transient: boolean; code: string; message: string } {
  const err = e as { code?: string; statusCode?: number; message?: string; name?: string };
  const code = err?.code ?? err?.name ?? "UNKNOWN";
  const message = err?.message ?? String(e);
  // HTTP status from SDK if present
  const statusCode = err?.statusCode;
  if (RETRYABLE_ERROR_CODES.has(code)) return { transient: true, code, message };
  if (typeof statusCode === "number" && statusCode >= 500 && statusCode < 600) {
    return { transient: true, code: `HTTP_${statusCode}`, message };
  }
  // 4xx, validation, config-missing, etc. — not transient
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return { transient: false, code: `HTTP_${statusCode}`, message };
  }
  // Default: treat as non-transient (safer — no retry storm on unknown failures)
  return { transient: false, code, message };
}

type CreateCheckoutOrderResult = {
  transactionId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  // Phase 9: indicates whether the order was reused (idempotent reuse)
  reused: boolean;
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

type RecordPaymentFailureArgs = {
  transactionId: string;
  source: string; // e.g. "payment_failed_webhook", "verify_error"
  reason: string;
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

export const CheckoutService = {
  /**
   * Phase 9: create a Razorpay order for a transaction.
   *
   * Idempotency contract:
   *   - If transaction is in APPROVED: create a new order (this is the only path).
   *   - If transaction is in ORDER_CREATED / PAYMENT_PENDING / PAYMENT_PROCESSING /
   *     PAYMENT_SUCCESS and already has a razorpayOrderId: REUSE it. Do NOT
   *     create another. Return the existing order info.
   *   - If transaction is in PAYMENT_FAILED / PAYMENT_UNKNOWN: do NOT create
   *     another order. Operator must explicitly create a new transaction
   *     (the failure is terminal in this state machine — no auto-retry).
   *   - If transaction is in any other state (DRAFT, CART_READY,
   *     APPROVAL_PENDING): reject with INVALID_STATE — no Razorpay call.
   *
   * Retry:
   *   - Exactly one retry on transient (network/5xx) errors.
   *   - No retry on validation, config, or 4xx errors.
   *   - No retry loop.
   *
   * Amount/currency authority:
   *   - Always taken from the immutable transaction snapshot. Never from input.
   *   - @unique razorpayOrderId constraint enforced at DB level.
   */
  async createCheckoutOrder(
    transactionId: string,
    opts: { client?: RazorpayClient } = {}
  ): Promise<CreateCheckoutOrderResult> {
    if (!transactionId || typeof transactionId !== "string") {
      throw Object.assign(new Error("transactionId required"), { code: "INVALID_INPUT", status: 400 });
    }

    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) {
      throw Object.assign(new Error("Transaction not found"), { code: "TRANSACTION_NOT_FOUND", status: 404 });
    }

    // Phase 9: idempotent order reuse. If a Razorpay order already exists
    // and the transaction is in a payment-flow state, return the existing
    // order info verbatim from the authoritative snapshot. No new Razorpay call.
    const REUSABLE_STATES: TransactionStatus[] = [
      "ORDER_CREATED",
      "PAYMENT_PENDING",
      "PAYMENT_PROCESSING",
      "PAYMENT_SUCCESS",
    ];
    if (txn.razorpayOrderId && REUSABLE_STATES.includes(txn.status as TransactionStatus)) {
      const { keyId } = getRazorpayKeys();
      const snapshot = JSON.parse(txn.snapshot) as { total: number; currency: string };
      return {
        transactionId: txn.id,
        razorpayOrderId: txn.razorpayOrderId,
        amount: snapshot.total,
        currency: snapshot.currency,
        keyId,
        reused: true,
      };
    }

    // PAYMENT_FAILED / PAYMENT_UNKNOWN are terminal — no second order.
    if (txn.status === "PAYMENT_FAILED" || txn.status === "PAYMENT_UNKNOWN") {
      throw Object.assign(
        new Error(
          `Cannot create a new Razorpay order: transaction is ${txn.status}. Create a new transaction to retry.`
        ),
        { code: "TERMINAL_STATE", status: 409, currentStatus: txn.status }
      );
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

    // Phase 9: use isolated Razorpay boundary; test seam allows fake client
    const { keyId } = getRazorpayKeys();
    const client = opts.client ?? getRazorpayClient();

    let razorpayOrder: { id: string };
    let retryUsed = false;
    try {
      const receipt = txn.id.slice(0, 40);
      const input = {
        amount,
        currency,
        receipt,
        notes: {
          transactionId: txn.id,
          cartHash: txn.cartHash,
          merchantId: txn.merchantId,
        },
      };
      // First attempt
      try {
        razorpayOrder = await client.createOrder(input);
      } catch (firstError) {
        const cls = classifyError(firstError);
        if (cls.transient) {
          // Exactly ONE retry on transient
          retryUsed = true;
          await AuditService.log({
            eventType: "CHECKOUT_ORDER_RETRY",
            transactionId: txn.id,
            cartId: txn.cartId,
            fromState: txn.status as TransactionStatus,
            toState: null,
            cartHash: txn.cartHash,
            isSimulated: false,
            verificationSource: `checkout_retry_${cls.code}`,
          });
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
          razorpayOrder = await client.createOrder(input);
        } else {
          throw firstError;
        }
      }
    } catch (e) {
      await AuditService.log({
        eventType: "CHECKOUT_ORDER_CREATE_FAILED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: txn.status as TransactionStatus,
        toState: null,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: retryUsed ? "checkout_retry_exhausted" : "checkout_create",
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

    // Persist razorpayOrderId and transition APPROVED → ORDER_CREATED.
    // The DB @unique constraint on razorpayOrderId is the final guard against
    // a concurrent duplicate creation; in that case we re-read the existing
    // transaction and return its data (idempotent).
    let afterOrderCreated;
    try {
      afterOrderCreated = await prisma.transaction.update({
        where: { id: txn.id },
        data: { razorpayOrderId, status: "ORDER_CREATED" },
      });
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === "P2002") {
        // Race: another concurrent createCheckoutOrder won. Re-read and reuse.
        const existing = await prisma.transaction.findUnique({ where: { razorpayOrderId } });
        if (existing && existing.id !== txn.id) {
          // Different transaction claimed this razorpay order id — surface as failure
          throw Object.assign(new Error("Razorpay order id conflict with a different transaction"), {
            code: "RAZORPAY_ORDER_CONFLICT",
            status: 409,
          });
        }
        afterOrderCreated = await prisma.transaction.findUnique({ where: { id: txn.id } });
      } else {
        throw e;
      }
    }

    if (!afterOrderCreated) {
      throw Object.assign(new Error("Transaction disappeared after order creation"), {
        code: "INTERNAL",
        status: 500,
      });
    }

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
      reused: false,
    };
  },

  /**
   * Phase 9: verify a payment signature and transition to PAYMENT_SUCCESS.
   * Idempotent: repeated calls with the same valid signature return the
   * existing success. Invalid signatures NEVER produce success.
   */
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

    // Idempotent successful verification — repeated valid verify returns existing SUCCESS
    if (txn.status === "PAYMENT_SUCCESS") {
      if (txn.razorpayOrderId === razorpayOrderId && txn.razorpayPaymentId === razorpayPaymentId) {
        // Re-verify signature even on the idempotent path — invalid sigs must still be rejected
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
      // Already success but different payment details — reject (cannot downgrade)
      throw Object.assign(new Error("Transaction already completed with different payment"), {
        code: "ALREADY_SUCCESS",
        status: 409,
      });
    }

    // PAYMENT_FAILED / PAYMENT_UNKNOWN are terminal — verify cannot recover
    if (txn.status === "PAYMENT_FAILED" || txn.status === "PAYMENT_UNKNOWN") {
      throw Object.assign(
        new Error(`Transaction is ${txn.status}; cannot verify payment. Create a new transaction.`),
        { code: "TERMINAL_STATE", status: 409, currentStatus: txn.status }
      );
    }

    // Require correct payment state
    if (txn.status !== "PAYMENT_PENDING" && txn.status !== "PAYMENT_PROCESSING") {
      throw Object.assign(new Error(`Transaction status ${txn.status} is not valid for payment verification`), {
        code: "INVALID_STATE",
        status: 409,
        from: txn.status,
      });
    }

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

    // Verify HMAC SHA256 server-side
    const { keySecret } = getRazorpayKeys();
    const message = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSignature = createHmac("sha256", keySecret).update(message).digest("hex");

    let signatureValid = false;
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
      // Invalid signatures must NEVER produce PAYMENT_SUCCESS
      throw Object.assign(new Error("Invalid payment signature"), { code: "INVALID_SIGNATURE", status: 400 });
    }

    // Signature valid — persist razorpayPaymentId only after validation and transition
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

  /**
   * Phase 9: record a definitive payment failure.
   * Transitions PAYMENT_PENDING / PAYMENT_PROCESSING → PAYMENT_FAILED.
   * Idempotent: repeated calls on a terminal state are a no-op (still audit).
   * Cannot downgrade PAYMENT_SUCCESS.
   */
  async recordPaymentFailure(args: RecordPaymentFailureArgs): Promise<{ status: TransactionStatus; transitioned: boolean }> {
    const { transactionId, source, reason } = args;
    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) {
      throw Object.assign(new Error("Transaction not found"), { code: "TRANSACTION_NOT_FOUND", status: 404 });
    }

    // Cannot downgrade success
    if (txn.status === "PAYMENT_SUCCESS") {
      await AuditService.log({
        eventType: "PAYMENT_FAILURE_DOWNGRADE_REJECTED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: "PAYMENT_SUCCESS" as TransactionStatus,
        toState: "PAYMENT_SUCCESS" as TransactionStatus,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: source,
      });
      return { status: "PAYMENT_SUCCESS", transitioned: false };
    }

    // Idempotent — already failed
    if (txn.status === "PAYMENT_FAILED") {
      await AuditService.log({
        eventType: "PAYMENT_FAILURE_IDEMPOTENT",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: "PAYMENT_FAILED" as TransactionStatus,
        toState: "PAYMENT_FAILED" as TransactionStatus,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: source,
      });
      return { status: "PAYMENT_FAILED", transitioned: false };
    }

    // Only transition from valid states
    if (!canTransition(txn.status as TransactionStatus, "PAYMENT_FAILED")) {
      throw Object.assign(
        new Error(`Cannot transition ${txn.status} → PAYMENT_FAILED`),
        { code: "INVALID_STATE", status: 409, from: txn.status }
      );
    }

    transition(txn.status as TransactionStatus, "PAYMENT_FAILED");
    const fromState = txn.status as TransactionStatus;
    const updated = await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "PAYMENT_FAILED", paymentStatus: "failed" },
    });

    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState,
      toState: "PAYMENT_FAILED" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: source,
    });

    await AuditService.log({
      eventType: "PAYMENT_FAILED",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState,
      toState: "PAYMENT_FAILED" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: source,
    });

    // Store the reason as a separate audit (does not include secrets)
    await AuditService.log({
      eventType: "PAYMENT_FAILURE_REASON",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "PAYMENT_FAILED" as TransactionStatus,
      toState: "PAYMENT_FAILED" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: `${source}:${reason.slice(0, 200)}`,
    });

    return { status: updated.status as TransactionStatus, transitioned: true };
  },

  /**
   * Phase 9: mark a payment as UNKNOWN (ambiguous upstream outcome).
   * Use when the result is uncertain — network timeout after payment initiation,
   * Razorpay status unreachable, etc. NEVER auto-converted to SUCCESS.
   */
  async markPaymentUnknown(args: RecordPaymentFailureArgs): Promise<{ status: TransactionStatus; transitioned: boolean }> {
    const { transactionId, source, reason } = args;
    const txn = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) {
      throw Object.assign(new Error("Transaction not found"), { code: "TRANSACTION_NOT_FOUND", status: 404 });
    }

    // Cannot downgrade success
    if (txn.status === "PAYMENT_SUCCESS") {
      await AuditService.log({
        eventType: "PAYMENT_UNKNOWN_DOWNGRADE_REJECTED",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: "PAYMENT_SUCCESS" as TransactionStatus,
        toState: "PAYMENT_SUCCESS" as TransactionStatus,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: source,
      });
      return { status: "PAYMENT_SUCCESS", transitioned: false };
    }

    // Idempotent — already unknown
    if (txn.status === "PAYMENT_UNKNOWN") {
      await AuditService.log({
        eventType: "PAYMENT_UNKNOWN_IDEMPOTENT",
        transactionId: txn.id,
        cartId: txn.cartId,
        fromState: "PAYMENT_UNKNOWN" as TransactionStatus,
        toState: "PAYMENT_UNKNOWN" as TransactionStatus,
        cartHash: txn.cartHash,
        isSimulated: false,
        verificationSource: source,
      });
      return { status: "PAYMENT_UNKNOWN", transitioned: false };
    }

    if (!canTransition(txn.status as TransactionStatus, "PAYMENT_UNKNOWN")) {
      throw Object.assign(
        new Error(`Cannot transition ${txn.status} → PAYMENT_UNKNOWN`),
        { code: "INVALID_STATE", status: 409, from: txn.status }
      );
    }

    transition(txn.status as TransactionStatus, "PAYMENT_UNKNOWN");
    const fromState = txn.status as TransactionStatus;
    const updated = await prisma.transaction.update({
      where: { id: txn.id },
      data: { status: "PAYMENT_UNKNOWN", paymentStatus: "unknown" },
    });

    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState,
      toState: "PAYMENT_UNKNOWN" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: source,
    });

    await AuditService.log({
      eventType: "PAYMENT_UNKNOWN",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState,
      toState: "PAYMENT_UNKNOWN" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: source,
    });

    await AuditService.log({
      eventType: "PAYMENT_UNKNOWN_REASON",
      transactionId: txn.id,
      cartId: txn.cartId,
      fromState: "PAYMENT_UNKNOWN" as TransactionStatus,
      toState: "PAYMENT_UNKNOWN" as TransactionStatus,
      cartHash: txn.cartHash,
      isSimulated: false,
      verificationSource: `${source}:${reason.slice(0, 200)}`,
    });

    return { status: updated.status as TransactionStatus, transitioned: true };
  },
};
