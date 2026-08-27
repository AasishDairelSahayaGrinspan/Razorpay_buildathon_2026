import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { ApiProduct } from "@/server/catalog";

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function ProductCard({
  product,
  variant = "shop",
  onAdd,
  loading,
}: {
  product: ApiProduct;
  variant?: "shop" | "merchant";
  onAdd?: (productId: string) => void;
  loading?: boolean;
}) {
  const isOutOfStock = !product.available;
  const isInactive = !product.active;

  return (
    <Card hover={!isInactive} className={isInactive ? "opacity-60" : ""}>
      <CardContent className="p-0">
        <div className="h-[140px] rounded-t-[12px] bg-[#f3f4f6] flex flex-col items-center justify-center gap-1 border-b border-[var(--border)] overflow-hidden">
          {product.image ? (
            <div className="text-[11px] text-[var(--muted-foreground)] px-3 text-center break-all">{product.image}</div>
          ) : (
            <span className="text-[12px] text-[var(--muted-foreground)]">No image</span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{product.category}</span>
        </div>
        <div className="p-4 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14px] font-semibold leading-5">{product.name}</h3>
            {isInactive ? <Badge variant="neutral">Inactive</Badge> : isOutOfStock ? <Badge variant="warning">Out of stock</Badge> : <Badge variant="success">{formatPrice(product.price)}</Badge>}
          </div>

          <p className="text-[13px] leading-5 text-[var(--muted-foreground)] line-clamp-2">{product.description}</p>

          {variant === "shop" && !isInactive ? (
            <div className="flex flex-wrap gap-1.5">
              {product.tags
                ?.split(",")
                .slice(0, 2)
                .map((t) => (
                  <Badge key={t} variant="outline">
                    {t.trim()}
                  </Badge>
                ))}
            </div>
          ) : null}

          <div className="mt-1 flex items-center justify-between">
            <span className="text-[12px] text-[var(--muted-foreground)]">Inventory: {product.inventory}</span>
            <span className="text-[11px] font-medium text-[var(--muted-foreground)]">{product.available ? "Available" : product.active ? "Unavailable" : "Inactive"}</span>
          </div>

          {variant === "shop" ? (
            onAdd && !isInactive && !isOutOfStock ? (
              <Button size="sm" variant="primary" onClick={() => onAdd(product.id)} loading={loading} className="mt-2 w-full">
                Add to cart — {formatPrice(product.price)}
              </Button>
            ) : (
              <Button size="sm" variant={isOutOfStock ? "secondary" : "secondary"} disabled className="mt-2 w-full" aria-disabled>
                {isInactive ? "Inactive — hidden from AI" : isOutOfStock ? "Out of stock" : `Add to cart — ${formatPrice(product.price)}`}
              </Button>
            )
          ) : (
            <div className="mt-1 flex gap-2 text-[11px] text-[var(--muted-foreground)]">
              <span>ID: {product.id.slice(0, 8)}…</span>
              <span className="ml-auto">{formatPrice(product.price)} • {product.currency}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
