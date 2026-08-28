import { prisma } from "@/lib/prisma";
import type { TransactionStatus } from "@/server/transaction/stateMachine";

export type AuditData = {
  eventType: string;
  transactionId?: string | null;
  cartId?: string | null;
  requestId?: string | null;
  fromState?: TransactionStatus | null;
  toState?: TransactionStatus | null;
  cartHash?: string | null;
  policyPassed?: number | null;
  policyTotal?: number | null;
  isSimulated?: boolean;
  verificationSource?: string | null;
};

export const AuditService = {
  async log(data: AuditData) {
    // fire-and-forget, but await for Phase 5 determinism
    try {
      await prisma.auditEvent.create({
        data: {
          eventType: data.eventType,
          transactionId: data.transactionId ?? undefined,
          cartId: data.cartId ?? undefined,
          requestId: data.requestId ?? undefined,
          fromState: data.fromState ?? undefined,
          toState: data.toState ?? undefined,
          cartHash: data.cartHash ?? undefined,
          policyPassed: data.policyPassed ?? undefined,
          policyTotal: data.policyTotal ?? undefined,
          isSimulated: data.isSimulated ?? false,
          verificationSource: data.verificationSource ?? undefined,
        },
      });
    } catch (e) {
      console.error("[AuditService] failed", e);
    }
  },

  async listByTransaction(transactionId: string) {
    return prisma.auditEvent.findMany({ where: { transactionId }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] });
  },

  async listByCart(cartId: string) {
    return prisma.auditEvent.findMany({ where: { cartId }, orderBy: [{ timestamp: "asc" }, { id: "asc" }] });
  },
};
