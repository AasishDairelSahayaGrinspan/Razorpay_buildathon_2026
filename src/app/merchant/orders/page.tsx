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
  if (status === "APPROVED" || status === "ORDER_CREATED" || status === "PAYMENT_PENDING" || status === "PAYMENT_PROCESSING") return "info";
  if (status === "PAYMENT_FAILED" || status === "PAYMENT_UNKNOWN") return "danger";
  if (status === "APPROVAL_PENDING") return "warning";
  return "neutral";
}

export default async function OrdersPage() {
  let transactions: Awaited<ReturnType<typeof prisma.transaction.findMany>> = [];
  let error: string | null = null;
  try {
    transactions = await prisma.transaction.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load orders";
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Orders"
        description="Immutable checkout snapshots, cart hash, idempotencyKey. 11-state machine."
        breadcrumbs={["Merchant", "Orders"]}
        actions={<Badge variant="neutral">{transactions.length} transactions</Badge>}
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8 flex flex-col gap-4">
        {error ? (
          <ErrorState title="Failed to load orders" description={error} />
        ) : transactions.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              title="No orders yet"
              description="Orders created via POST /api/checkout/order after explicit approval. Duplicate protection via transaction unique cartId+cartHash."
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
                    <TableHead>Total</TableHead>
                    <TableHead>Cart hash</TableHead>
                    <TableHead>Razorpay order</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Audit</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-[11px] max-w-[180px]">
                        <div className="flex flex-col">
                          <span className="font-medium truncate">{t.id.slice(0, 12)}…</span>
                          <span className="text-[10px] text-[var(--muted-foreground)] truncate">cart {t.cartId.slice(0, 8)}…</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                        {t.paymentStatus ? <div className="text-[10px] text-[var(--muted-foreground)] font-mono">{t.paymentStatus}</div> : null}
                      </TableCell>
                      <TableCell className="font-medium text-[12px]">
                        {formatPrice(t.total)} <span className="text-[10px] text-[var(--muted-foreground)]">{t.currency}</span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px]">{t.cartHash.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-[11px] max-w-[160px] truncate">{t.razorpayOrderId ?? "—"}</TableCell>
                      <TableCell className="text-[11px] whitespace-nowrap">{new Date(t.createdAt).toLocaleString("en-IN", { hour12: false })}</TableCell>
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
          Showing up to 50 most recent transactions, ordered by createdAt desc, id desc. Snapshot immutable via <span className="font-mono">Transaction.snapshot</span> JSON.
        </div>
      </div>
    </div>
  );
}
