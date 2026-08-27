import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";

export default function OrdersPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Orders" description="Immutable checkout snapshots, cart hash, idempotencyKey. 11-state machine." breadcrumbs={["Merchant", "Orders"]} />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8">
        <Card className="p-6">
          <EmptyState title="No orders yet" description="Orders created via POST /api/checkout/orders after explicit approval. Duplicate protection via idempotencyKey." />
        </Card>
      </div>
    </div>
  );
}
