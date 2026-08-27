import * as React from "react";
import { Badge } from "./ui/badge";

export function PageHeader({
  title,
  description,
  badge,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  badge?: string;
  actions?: React.ReactNode;
  breadcrumbs?: string[];
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-white px-6 py-5 lg:px-8">
      {breadcrumbs ? (
        <nav className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)]">
          {breadcrumbs.map((b, i) => (
            <React.Fragment key={b}>
              {i > 0 ? <span className="text-[#e5e7eb]">/</span> : null}
              <span className={i === breadcrumbs.length - 1 ? "text-[var(--foreground)] font-medium" : ""}>{b}</span>
            </React.Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-[20px] font-semibold leading-7 tracking-tight">{title}</h1>
            {badge ? <Badge variant="info">{badge}</Badge> : null}
          </div>
          {description ? <p className="max-w-[640px] text-[13px] leading-5 text-[var(--muted-foreground)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
