import * as React from "react";

export function Card({
  className = "",
  hover = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean }) {
  return (
    <div
      className={[
        "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)]",
        "shadow-[var(--shadow-card)]",
        hover ? "hover:shadow-[var(--shadow-card-hover)] transition-shadow" : "",
        className,
      ].join(" ")}
      {...props}
    />
  );
}

export function CardHeader({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["flex flex-col gap-1 p-6 pb-3", className].join(" ")} {...props} />;
}

export function CardTitle({ className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={["text-[16px] font-semibold leading-6 tracking-[-0.01em]", className].join(" ")} {...props} />;
}

export function CardDescription({ className = "", ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={["text-[13px] leading-5 text-[var(--muted-foreground)]", className].join(" ")} {...props} />;
}

export function CardContent({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["p-6 pt-0", className].join(" ")} {...props} />;
}

export function CardFooter({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={["flex items-center p-6 pt-0", className].join(" ")} {...props} />;
}
