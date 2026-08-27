import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AuditPage() {
  const events = [
    { step: 1, title: "Agent Decision", desc: "search_catalog → recommend", status: "future" },
    { step: 2, title: "Cart Created", desc: "snapshot + cartHash", status: "future" },
    { step: 3, title: "User Approval", desc: "POST /api/approval", status: "future" },
    { step: 4, title: "Policy Validation", desc: "dynamic named checks", status: "future" },
    { step: 5, title: "Razorpay Order", desc: "create_order (Test)", status: "future" },
    { step: 6, title: "Payment", desc: "webhook → verify", status: "future" },
  ];

  return (
    <div className="flex flex-col">
      <PageHeader title="Audit Trail" description="First-class audit: every agent run, cart, approval, policy, order, payment, webhook with timestamps and IDs." breadcrumbs={["Merchant", "Audit"]} />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-[14px]">Timeline — Phase 8</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {events.map((e) => (
              <div key={e.step} className="flex gap-4 py-3 border-b border-[var(--border)] last:border-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[11px] font-semibold text-[var(--muted-foreground)]">
                  {e.step}
                </div>
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">{e.title}</span>
                  <span className="text-[12px] text-[var(--muted-foreground)]">{e.desc}</span>
                </div>
                <Badge variant="neutral" className="ml-auto h-fit">
                  pending
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
