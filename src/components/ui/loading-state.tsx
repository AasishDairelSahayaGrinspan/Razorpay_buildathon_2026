export function LoadingState({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--primary)]" />
      <p className="text-[13px] text-[var(--muted-foreground)]">{message}</p>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={["animate-pulse rounded-md bg-[#f3f4f6]", className].join(" ")} />;
}

export function TableSkeleton() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-white overflow-hidden">
      <div className="h-9 bg-[#f9fafb] border-b border-[var(--border)] animate-pulse" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 border-b border-[var(--border)] last:border-0">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}
