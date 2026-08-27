import * as React from "react";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const variantStyles: Record<Variant, string> = {
  primary:
    "bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] shadow-[var(--shadow-button)] border border-transparent",
  secondary:
    "bg-white text-[var(--foreground)] border border-[var(--border)] hover:bg-[#f9fafb] shadow-[var(--shadow-button)]",
  ghost:
    "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] border border-transparent",
  outline:
    "bg-white text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--muted)]",
  destructive:
    "bg-[var(--danger)] text-white hover:bg-[#be123c] border border-transparent shadow-[var(--shadow-button)]",
};

const sizeStyles: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] font-medium",
  md: "h-9 px-4 text-[14px] font-medium",
  lg: "h-11 px-6 text-[14px] font-semibold",
  icon: "h-9 w-9 p-0",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center rounded-[var(--radius-sm)] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      ].join(" ")}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </button>
  );
}
