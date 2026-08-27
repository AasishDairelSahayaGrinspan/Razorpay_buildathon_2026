import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";

export default function PaymentsPage() {
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Payments"
        description="Server-side verification only. Webhook primary, poll fallback. Never trust frontend callback."
        breadcrumbs={["Merchant", "Payments"]}
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8">
        <Card className="p-6">
          <EmptyState title="No payments yet" description="Payments verified via Razorpay fetch_order_payments / fetch_payment. States: PENDING → PROCESSING → SUCCESS|FAILED|UNKNOWN." />
        </Card>
      </div>
    </div>
  );
}
