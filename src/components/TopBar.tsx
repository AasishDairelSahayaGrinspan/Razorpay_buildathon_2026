"use client";

import { Button } from "./ui/button";

export function TopBar({ onMenuClick }: { onMenuClick: () => void }) {
  return (
    <header
      className="sticky top-0 z-20 flex h-[56px] items-center gap-3 border-b border-[var(--topbar-border)] bg-[var(--topbar)] px-4 lg:px-6"
      style={{ boxShadow: "0 1px 0 rgba(0,0,0,0.02)" }}
    >
      <Button variant="ghost" size="icon" className="lg:hidden -ml-2" onClick={onMenuClick} aria-label="Open menu">
        <span className="text-[16px]">☰</span>
      </Button>

      <div className="hidden lg:flex items-center gap-3 text-[13px] text-[var(--muted-foreground)]">
        <span className="text-[var(--foreground)] font-medium">Nimbus Commerce</span>
        <span className="text-[#e5e7eb]">/</span>
        <span>AI Growth & Agentic Commerce — Test</span>
      </div>

      {/* Search — Razorpay-style pill */}
      <div className="ml-auto hidden md:flex items-center">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[#9ca3af]">⌕</span>
          <input
            placeholder="Search products, orders, audit..."
            className="h-9 w-[320px] rounded-[8px] border border-[var(--border)] bg-[#f9fafb] pl-8 pr-3 text-[13px] placeholder:text-[#9ca3af] focus:bg-white focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/20"
          />
        </div>
      </div>

      {/* TEST pill — black as in screenshots */}
      <div className="ml-auto md:ml-3 flex items-center gap-2 rounded-full bg-[var(--topbar-pill)] px-3 py-1.5 text-white">
        <span className="h-2 w-2 rounded-full bg-[#22c55e] shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
        <span className="text-[11px] font-semibold tracking-widest">TEST</span>
        <span className="hidden sm:inline text-[11px] text-white/60 ml-1">Mode</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-white text-[13px] hover:bg-[var(--muted)]" aria-label="Help">?</button>
        <div className="h-8 w-8 rounded-full bg-[#0b5fff] flex items-center justify-center text-[11px] font-bold text-white">AD</div>
      </div>
    </header>
  );
}
