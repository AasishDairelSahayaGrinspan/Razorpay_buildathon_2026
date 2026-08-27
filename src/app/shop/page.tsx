import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CatalogService } from "@/server/catalog";
import { ShopChat } from "@/components/shop/ShopChat";

export const dynamic = "force-dynamic";

export default async function ShopPage() {
  let products: Awaited<ReturnType<typeof CatalogService.listProducts>> = [];
  let error: string | null = null;
  try {
    products = await CatalogService.listProducts({ activeOnly: true });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load catalog";
  }
  const apiProducts = products.map((p) => CatalogService.toApi(p));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="AI Commerce"
        description="Recommendation-only agent: natural language → explainable catalog picks. Prices server-authoritative, no payment until explicit approval."
        badge="Phase 3"
        breadcrumbs={["Shop", "AI Commerce"]}
        actions={
          <>
            <Badge variant="success">Test Mode</Badge>
            <Badge variant="neutral">{apiProducts.length} products</Badge>
          </>
        }
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8 flex flex-col gap-6">
        {error ? (
          <Card><CardContent className="p-6 text-[13px] text-[#e11d48]">{error}</CardContent></Card>
        ) : (
          <ShopChat initialProducts={apiProducts} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-[13px]">Architecture wall</CardTitle>
            <CardDescription>UI → API → CatalogService → DB. Agent never imports checkout/razorpay/prisma. Try “create payment” — blocked.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
            {["User message", "Agent tools", "CatalogService", "Server price"].map((k) => (
              <div key={k} className="rounded-md border border-[var(--border)] bg-[#f9fafb] p-3">
                <p className="text-[12px] font-medium">{k}</p>
                <p className="text-[10px] text-[var(--muted-foreground)]">ok</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
