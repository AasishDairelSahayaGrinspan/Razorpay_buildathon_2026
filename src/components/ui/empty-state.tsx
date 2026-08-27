import { Button } from "./button";

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] bg-white px-8 py-12 text-center">
      {icon ? <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f3f4f6] text-[var(--muted-foreground)]">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold leading-6">{title}</h3>
      {description ? <p className="max-w-sm text-[13px] leading-5 text-[var(--muted-foreground)]">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="primary" size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
