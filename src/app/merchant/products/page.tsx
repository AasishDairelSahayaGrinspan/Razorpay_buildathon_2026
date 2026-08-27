import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge, DotBadge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CatalogService } from "@/server/catalog";
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export default async function ProductsPage() {
  let products: Awaited<ReturnType<typeof CatalogService.listProducts>> = [];
  let error: string | null = null;
  try {
    // Include inactive to show all for merchant view, then separate
    products = await CatalogService.listProducts({ activeOnly: false });
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load products";
  }

  const active = products.filter((p) => p.active);
  const inactive = products.filter((p) => !p.active);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Products"
        description="Real catalog from server — prices in paise (int), server-authoritative. Browser cannot redefine price/currency/inventory."
        breadcrumbs={["Merchant", "Products"]}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral">{products.length} total</Badge>
            <Badge variant="success">{active.length} active</Badge>
            <Button size="sm" disabled>
              Add product — later
            </Button>
          </div>
        }
      />
      <div className="mx-auto w-full max-w-[1280px] p-6 lg:p-8 flex flex-col gap-6">
        {error ? (
          <ErrorState title="Catalog failed" description={error} />
        ) : products.length === 0 ? (
          <EmptyState title="No products" description="Run prisma seed to populate catalog." />
        ) : (
          <>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <tr>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Price (paise)</TableHead>
                      <TableHead>Price display</TableHead>
                      <TableHead>Inventory</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead>Status</TableHead>
                    </tr>
                  </TableHeader>
                  <TableBody>
                    {products.map((p) => {
                      const available = p.active && p.inventory > 0;
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium max-w-[280px]">
                            <div className="flex flex-col">
                              <span className="truncate">{p.name}</span>
                              <span className="text-[11px] text-[var(--muted-foreground)] truncate">{p.id.slice(0, 8)}…</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-[var(--muted-foreground)]">{p.category}</TableCell>
                          <TableCell className="font-mono text-[12px]">{p.price}</TableCell>
                          <TableCell>{formatPrice(p.price)}</TableCell>
                          <TableCell>{p.inventory}</TableCell>
                          <TableCell>
                            {available ? <DotBadge variant="success">Available</DotBadge> : p.active ? <DotBadge variant="warning">Out of stock</DotBadge> : <DotBadge variant="neutral">Inactive</DotBadge>}
                          </TableCell>
                          <TableCell>
                            <Badge variant={p.active ? "success" : "neutral"}>{p.active ? "Active" : "Inactive"}</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {inactive.length > 0 ? (
              <div className="rounded-md border border-[var(--border)] bg-[#fffbeb] px-4 py-3 text-[12px] text-[#92400e]">
                <strong>{inactive.length} inactive</strong> products are hidden from shop & AI — shown here for merchant audit only.
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardContent className="p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Integrity</p>
                  <p className="mt-1 text-[13px] leading-5">All prices are integers in paise. Cart will consume productId + qty only. API returns authoritative price.</p>
                  <p className="mt-2 text-[11px] font-mono bg-[#f9fafb] border border-[var(--border)] rounded p-2">price: 399900 → ₹3,999.00 (calc: paise/100)</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">API Coverage</p>
                  <ul className="mt-1 text-[12px] leading-5 text-[var(--muted-foreground)] list-disc pl-4">
                    <li>GET /api/products</li>
                    <li>GET /api/products/search?query=&category=&maxPrice=</li>
                    <li>GET /api/products/[id]</li>
                    <li>GET /api/products/[id]/availability</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
