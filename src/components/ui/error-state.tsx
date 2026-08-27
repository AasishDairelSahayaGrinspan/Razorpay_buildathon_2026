import { Button } from "./button";

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this content. Please try again.",
  onRetry,
  onBack,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-[#fecdd3] bg-[#fff1f2] px-8 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#fecdd3] text-[#e11d48]">!</div>
      <h3 className="text-[15px] font-semibold text-[#881337]">{title}</h3>
      <p className="max-w-sm text-[13px] leading-5 text-[#9f1239]">{description}</p>
      <div className="mt-2 flex gap-2">
        {onRetry ? (
          <Button variant="destructive" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {onBack ? (
          <Button variant="secondary" size="sm" onClick={onBack}>
            Go back
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[#fecdd3] bg-[#fff1f2] px-3 py-2 text-[13px] text-[#9f1239]">
      <span>{message}</span>
      {onRetry ? (
        <button onClick={onRetry} className="font-medium underline hover:no-underline">
          Retry
        </button>
      ) : null}
    </div>
  );
}
