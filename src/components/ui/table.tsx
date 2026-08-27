import * as React from "react";

export function Table({ className = "", ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-white">
      <table className={["w-full text-[13px]", className].join(" ")} {...props} />
    </div>
  );
}

export function TableHeader({ className = "", ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={["bg-[#f9fafb]", className].join(" ")} {...props} />;
}

export function TableBody({ className = "", ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={["divide-y divide-[var(--border)]", className].join(" ")} {...props} />;
}

export function TableRow({ className = "", ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={["hover:bg-[#f9fafb]/60 transition-colors", className].join(" ")} {...props} />;
}

export function TableHead({ className = "", ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={[
        "h-9 px-4 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)] whitespace-nowrap",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

export function TableCell({ className = "", ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={["px-4 py-3 align-middle", className].join(" ")} {...props} />;
}

export function TableCaption({ className = "", ...props }: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return <caption className={["mt-4 text-[13px] text-[var(--muted-foreground)]", className].join(" ")} {...props} />;
}
