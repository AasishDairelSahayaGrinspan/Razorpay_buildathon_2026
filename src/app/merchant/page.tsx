import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

export default function MerchantPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Merchant Overview"
        description="Manage catalog, prices, inventory, policies. See AI recommendations, orders, payments and audit trail."
        breadcrumbs={["Merchant", "Overview"]}
        badge="Overview"
        actions={<Button size="sm">Add product — Phase 2</Button>}
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8 flex flex-col gap-6">
        {/* KPI row — Razorpay-style */}
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Products", value: "—", sub: "Phase 2 seed" },
            { label: "Orders today", value: "—", sub: "Real metrics later" },
            { label: "Conversion", value: "—", sub: "AI Growth Phase 8" },
            { label: "AOV", value: "₹ —", sub: "Avg order value" },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">{k.label}</p>
                <p className="mt-1 text-[20px] font-semibold leading-7">{k.value}</p>
                <p className="text-[12px] text-[var(--muted-foreground)]">{k.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent orders</CardTitle>
                <CardDescription>Transaction state machine (11 states) — DRAFT to PAYMENT_UNKNOWN</CardDescription>
              </div>
              <Badge variant="neutral">Phase 6</Badge>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <tr>
                    <TableHead>Order</TableHead>
                    <TableHead>Cart total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                  </tr>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={4}>
                      <div className="py-6 text-center">
                        <EmptyState title="No orders yet" description="Orders appear after checkout via Razorpay Test Mode. State machine hard-gated." />
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">AI recommendations</CardTitle>
                <CardDescription>Agent decisions with explainable reasons</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-[13px] text-[var(--muted-foreground)]">
                <div className="rounded-md border border-[var(--border)] bg-[#f9fafb] p-3">
                  Example: Headphones ₹3,999 — “within budget, WFH, ANC”
                </div>
                <p className="text-[12px]">Available Phase 3. Every recommendation logged to audit.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-[14px]">Onboarding</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="h-1.5 w-full rounded-full bg-[#f3f4f6] overflow-hidden">
                  <div className="h-full bg-[var(--primary)] w-[1/4]" style={{ width: "33%" }} />
                </div>
                <p className="text-[12px] text-[var(--muted-foreground)]">1/3 — Shell complete. Next: catalog + agent.</p>
                <Button size="sm" variant="secondary" disabled>
                  Set up payments — Phase 2
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
