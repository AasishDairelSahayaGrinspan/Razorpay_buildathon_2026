import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function statusVariant(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "PAYMENT_SUCCESS") return "success";
  if (status === "PAYMENT_PROCESSING" || status === "PAYMENT_PENDING") return "info";
  if (status === "PAYMENT_FAILED" || status === "PAYMENT_UNKNOWN") return "danger";
  return "neutral";
}

export default async function PaymentsPage() {
  let transactions: Awaited<ReturnType<typeof prisma.transaction.findMany>> = [];
  let error: string | null = null;
  try {
    transactions = await prisma.transaction.findMany({
      where: {
        // Show only transactions that have entered checkout/payment flow or are approved
        status: { in: ["ORDER_CREATED", "PAYMENT_PENDING", "PAYMENT_PROCESSING", "PAYMENT_SUCCESS", "PAYMENT_FAILED", "PAYMENT_UNKNOWN"] },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    // If no checkout transactions, fallback to show approved as well for demo
    if (transactions.length === 0) {
      transactions = await prisma.transaction.findMany({
        where: { status: { in: ["APPROVED"] } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 10,
      });
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load payments";
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payments"
        description="Server-side verification only. Webhook primary, poll fallback. Never trust frontend callback."
        breadcrumbs={["Merchant", "Payments"]}
        actions={<Badge variant="neutral">{transactions.length} payments</Badge>}
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8 flex flex-col gap-4">
        {error ? (
          <ErrorState title="Failed to load payments" description={error} />
        ) : transactions.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              title="No payments yet"
              description="Server-authoritative payment state. PAYMENT_PENDING → PAYMENT_PROCESSING → PAYMENT_SUCCESS|PAYMENT_FAILED|PAYMENT_UNKNOWN. Verify via HMAC SHA256. Webhook handles payment.failed. UNKNOWN never auto-converts to SUCCESS."
            />
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order ID</TableHead>
                    <TableHead>Payment ID</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead>Audit</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-[11px] max-w-[160px]">
                        <div className="flex flex-col">
                          <span className="font-medium truncate">{t.id.slice(0, 12)}…</span>
                          <span className="text-[10px] text-[var(--muted-foreground)]">cart {t.cartId.slice(0, 8)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                        {t.paymentStatus ? <div className="text-[10px] font-mono text-[var(--muted-foreground)]">{t.paymentStatus}</div> : null}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[160px] truncate">{t.razorpayOrderId ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[160px] truncate">{t.razorpayPaymentId ?? "—"}</TableCell>
                      <TableCell className="text-[12px] font-medium">{formatPrice(t.total)}</TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap">{new Date(t.updatedAt).toLocaleString("en-IN", { hour12: false })}</TableCell>
                      <TableCell>
                        <Link href={`/merchant/audit?transactionId=${encodeURIComponent(t.id)}`}>
                          <Button size="sm" variant="secondary">
                            Audit
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        <div className="text-[11px] text-[var(--muted-foreground)]">
          Payment state is authoritative server state (Transaction.status + paymentStatus). Amount from <span className="font-mono">Transaction.total</span> (paise, snapshot) — never webhook amount. Audit via <span className="font-mono">?transactionId=</span>.
        </div>
      </div>
    </div>
  );
}
