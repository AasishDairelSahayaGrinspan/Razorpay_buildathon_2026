import { PageHeader } from "@/components/PageHeader";
import { AuditBrowser } from "./AuditBrowser";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Audit Trail" description="First-class audit: every agent run, cart, approval, policy, order, payment, webhook with timestamps and IDs." breadcrumbs={["Merchant", "Audit"]} />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8">
        <AuditBrowser />
      </div>
    </div>
  );
}
