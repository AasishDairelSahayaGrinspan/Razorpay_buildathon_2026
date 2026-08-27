import { prisma } from "@/lib/prisma";
import { CartService } from "../cart";
import { PolicyEngine } from "../policy/engine";
import { AuditService } from "../audit/service";
import { transition } from "../transaction/stateMachine";
import type { TransactionStatus } from "../transaction/stateMachine";

function makeRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export const ApprovalService = {
  async approve(cartId: string, clientCartHash: string, requestId?: string) {
    const reqId = requestId ?? makeRequestId();

    // 1. Load cart server-side
    const cart = await CartService.getCart(cartId);
    if (!cart) {
      await AuditService.log({
        eventType: "APPROVAL_REJECTED",
        cartId,
        requestId: reqId,
        cartHash: clientCartHash,
        isSimulated: false,
        verificationSource: "user_explicit_approval",
      });
      throw Object.assign(new Error("Cart not found"), { code: "CART_NOT_FOUND", status: 404 });
    }

    // 2. Recalculate hash already done in getCart (cart.hash is server canonical)
    // 3. Validate client hash
    if (cart.hash !== clientCartHash) {
      await AuditService.log({
        eventType: "APPROVAL_REJECTED_STALE",
        cartId,
        requestId: reqId,
        cartHash: clientCartHash,
        fromState: "CART_READY" as TransactionStatus,
        toState: null,
        isSimulated: false,
        verificationSource: "user_explicit_approval",
      });
      throw Object.assign(new Error(`Stale cart: server hash ${cart.hash.slice(0, 8)} vs client ${clientCartHash.slice(0, 8)}`), {
        code: "STALE_CART",
        status: 409,
      });
    }

    // 4. Idempotency: if existing APPROVED transaction for same cartId+cartHash, return it
    const existing = await prisma.transaction.findUnique({
      where: { cartId_cartHash: { cartId, cartHash: clientCartHash } },
    });
    if (existing && existing.status === "APPROVED") {
      await AuditService.log({
        eventType: "APPROVAL_IDEMPOTENT",
        transactionId: existing.id,
        cartId,
        requestId: reqId,
        fromState: existing.status as TransactionStatus,
        toState: existing.status as TransactionStatus,
        cartHash: clientCartHash,
        isSimulated: false,
        verificationSource: "user_explicit_approval",
      });
      const policy = await PolicyEngine.evaluate(cartId, clientCartHash);
      return { transaction: existing, policy, isIdempotent: true };
    }

    // 5. Create immutable snapshot
    const snapshot = {
      cartId: cart.id,
      merchantId: cart.merchantId,
      currency: cart.currency,
      items: cart.items.map((it) => ({
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        currency: it.currency,
        lineTotal: it.unitPrice * it.quantity,
      })),
      subtotal: cart.totals.subtotal,
      total: cart.totals.total,
      cartHash: cart.hash,
      createdAt: new Date().toISOString(),
    };

    // 6. Run PolicyEngine
    const policy = await PolicyEngine.evaluate(cartId, clientCartHash);
    if (!policy.approved) {
      // Create a transaction in APPROVAL_PENDING then stay there? For Phase 5, we create a transaction for audit but not APPROVED
      // We will create a transaction with status APPROVAL_PENDING to record the attempt, but not APPROVED
      // Use upsert to handle concurrent: try to create, if exists return existing
      try {
        const txn = await prisma.transaction.create({
          data: {
            cartId,
            merchantId: cart.merchantId,
            status: "APPROVAL_PENDING",
            currency: cart.currency,
            cartHash: clientCartHash,
            total: cart.totals.total,
            snapshot: JSON.stringify(snapshot),
          },
        });
        await AuditService.log({
          eventType: "POLICY_REJECTED",
          transactionId: txn.id,
          cartId,
          requestId: reqId,
          fromState: "APPROVAL_PENDING" as TransactionStatus,
          toState: "APPROVAL_PENDING" as TransactionStatus,
          cartHash: clientCartHash,
          policyPassed: policy.passed,
          policyTotal: policy.total,
          isSimulated: false,
          verificationSource: "user_explicit_approval",
        });
        // Do not transition to APPROVED
        throw Object.assign(new Error(`Policy failed: ${policy.checks.filter((c) => !c.passed).map((c) => c.name).join(", ")}`), {
          code: "POLICY_FAILED",
          status: 400,
          policy,
          transaction: txn,
        });
      } catch (e) {
        // If unique constraint race, fetch existing
        if ((e as { code?: string }).code === "P2002") {
          const dup = await prisma.transaction.findUnique({ where: { cartId_cartHash: { cartId, cartHash: clientCartHash } } });
          if (dup) {
            const pol = await PolicyEngine.evaluate(cartId, clientCartHash);
            return { transaction: dup, policy: pol, isIdempotent: true };
          }
        }
        throw e;
      }
    }

    // 7. Policy passed — create transaction through state machine DRAFT → CART_READY → APPROVAL_PENDING → APPROVED
    // We will create transaction and transition stepwise, using DB transactions for atomicity
    // Use a single create with status APPROVED but log transitions via audit for Phase 5 simplicity,
    // while still calling transition() to validate allowed paths
    try {
      // Validate transitions
      transition("DRAFT", "CART_READY");
      transition("CART_READY", "APPROVAL_PENDING");
      transition("APPROVAL_PENDING", "APPROVED");
    } catch (e) {
      throw Object.assign(new Error((e as Error).message), { code: "INVALID_TRANSITION", status: 400 });
    }

    // Idempotent create: try to create APPROVED, if duplicate due to race, return existing
    let transaction;
    try {
      transaction = await prisma.transaction.create({
        data: {
          cartId,
          merchantId: cart.merchantId,
          status: "APPROVED",
          currency: cart.currency,
          cartHash: clientCartHash,
          total: cart.totals.total,
          snapshot: JSON.stringify(snapshot),
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const dup = await prisma.transaction.findUnique({ where: { cartId_cartHash: { cartId, cartHash: clientCartHash } } });
        if (dup) {
          await AuditService.log({
            eventType: "APPROVAL_IDEMPOTENT",
            transactionId: dup.id,
            cartId,
            requestId: reqId,
            fromState: dup.status as TransactionStatus,
            toState: dup.status as TransactionStatus,
            cartHash: clientCartHash,
            policyPassed: policy.passed,
            policyTotal: policy.total,
            isSimulated: false,
            verificationSource: "user_explicit_approval",
          });
          return { transaction: dup, policy, isIdempotent: true };
        }
      }
      throw e;
    }

    // Audit events for each transition (for Phase 5, we log the final approval)
    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: transaction.id,
      cartId,
      requestId: reqId,
      fromState: "DRAFT" as TransactionStatus,
      toState: "CART_READY" as TransactionStatus,
      cartHash: clientCartHash,
      policyPassed: policy.passed,
      policyTotal: policy.total,
      isSimulated: false,
      verificationSource: "user_explicit_approval",
    });
    await AuditService.log({
      eventType: "STATE_TRANSITION",
      transactionId: transaction.id,
      cartId,
      requestId: reqId,
      fromState: "CART_READY" as TransactionStatus,
      toState: "APPROVAL_PENDING" as TransactionStatus,
      cartHash: clientCartHash,
      policyPassed: policy.passed,
      policyTotal: policy.total,
      isSimulated: false,
      verificationSource: "user_explicit_approval",
    });
    await AuditService.log({
      eventType: "APPROVAL_GRANTED",
      transactionId: transaction.id,
      cartId,
      requestId: reqId,
      fromState: "APPROVAL_PENDING" as TransactionStatus,
      toState: "APPROVED" as TransactionStatus,
      cartHash: clientCartHash,
      policyPassed: policy.passed,
      policyTotal: policy.total,
      isSimulated: false,
      verificationSource: "user_explicit_approval",
    });

    return { transaction, policy, isIdempotent: false };
  },
};
