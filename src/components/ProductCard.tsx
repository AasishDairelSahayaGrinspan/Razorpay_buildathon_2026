import * as React from "react";
import { Card, CardContent } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import type { ApiProduct } from "@/server/catalog";

function formatPrice(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function ProductImage({ product }: { product: ApiProduct }) {
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  if (!product.image || failed) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center text-[12px] text-[var(--muted-foreground)]">
        <span className="text-[28px] leading-none text-[#c7ccd4]">◆</span>
        <span>{product.name}</span>
      </span>
    );
  }

  return (
    <div className="relative h-full w-full">
      {!loaded ? (
        <span className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--muted-foreground)]">
          Loading…
        </span>
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={product.image}
        alt={product.name}
        className={`h-full w-full object-cover transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
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
        <div className="relative h-[140px] overflow-hidden rounded-t-[12px] border-b border-[var(--border)] bg-[#f3f4f6]">
          <ProductImage product={product} />
          <span className="absolute bottom-2 left-2 rounded-full bg-[#0a0a13]/70 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white">
            {product.category}
          </span>
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
