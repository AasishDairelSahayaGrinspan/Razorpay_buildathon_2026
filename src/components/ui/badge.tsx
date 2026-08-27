import * as React from "react";

type Variant = "default" | "success" | "warning" | "danger" | "info" | "neutral" | "outline";

const styles: Record<Variant, string> = {
  default: "bg-[var(--primary)] text-white border-transparent",
  success: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]",
  warning: "bg-[#fffbeb] text-[#92400e] border-[#fde68a]",
  danger: "bg-[#fef2f2] text-[#9f1239] border-[#fecdd3]",
  info: "bg-[#eff6ff] text-[#1e40af] border-[#bfdbfe]",
  neutral: "bg-[#f3f4f6] text-[#374151] border-[#e5e7eb]",
  outline: "bg-white text-[var(--muted-foreground)] border-[var(--border)]",
};

export function Badge({
  variant = "neutral",
  className = "",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-none tracking-wide",
        styles[variant],
        className,
      ].join(" ")}
      {...props}
    />
  );
}

// Dot variant — Razorpay style with leading dot
export function DotBadge({
  variant = "neutral",
  className = "",
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  const dotColor: Record<Variant, string> = {
    default: "bg-[var(--primary)]",
    success: "bg-[#0ba36a]",
    warning: "bg-[#f59e0b]",
    danger: "bg-[#e11d48]",
    info: "bg-[#0b5fff]",
    neutral: "bg-[#9ca3af]",
    outline: "bg-[#9ca3af]",
  };
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium",
        styles[variant],
        className,
      ].join(" ")}
      {...props}
    >
      <span className={["h-1.5 w-1.5 rounded-full", dotColor[variant]].join(" ")} />
      {children}
    </span>
  );
}
