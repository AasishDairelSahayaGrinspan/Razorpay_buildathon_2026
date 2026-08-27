import * as React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className = "", id, ...props }: InputProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-medium leading-none text-[var(--foreground)]">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        className={[
          "flex h-9 w-full rounded-[var(--radius-sm)] border border-[var(--input)] bg-white px-3 py-2",
          "text-[14px] placeholder:text-[#9ca3af]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-0 focus-visible:border-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-[var(--danger)] focus-visible:ring-[var(--danger)]" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : hint ? <p className="text-[12px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function Textarea({
  label,
  error,
  hint,
  className = "",
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string; hint?: string }) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={inputId} className="text-[13px] font-medium">
          {label}
        </label>
      ) : null}
      <textarea
        id={inputId}
        className={[
          "flex min-h-[80px] w-full rounded-[var(--radius-sm)] border border-[var(--input)] bg-white px-3 py-2",
          "text-[14px] placeholder:text-[#9ca3af]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          error ? "border-[var(--danger)]" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : hint ? <p className="text-[12px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}

export function Select({ label, error, hint, className = "", children, id, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string; error?: string; hint?: string }) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <label htmlFor={inputId} className="text-[13px] font-medium">{label}</label> : null}
      <select
        id={inputId}
        className={[
          "flex h-9 w-full rounded-[var(--radius-sm)] border border-[var(--input)] bg-white px-3 py-2 text-[14px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
          className,
        ].join(" ")}
        {...props}
      >
        {children}
      </select>
      {error ? <p className="text-[12px] text-[var(--danger)]">{error}</p> : hint ? <p className="text-[12px] text-[var(--muted-foreground)]">{hint}</p> : null}
    </div>
  );
}
