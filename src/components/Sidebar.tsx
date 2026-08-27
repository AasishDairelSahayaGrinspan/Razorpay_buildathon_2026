"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { label: string; href: string; badge?: string; icon: string };

const merchantNav: NavItem[] = [
  { label: "Overview", href: "/merchant", icon: "◧" },
  { label: "Products", href: "/merchant/products", icon: "▦" },
  { label: "Orders", href: "/merchant/orders", icon: "≡" },
  { label: "Payments", href: "/merchant/payments", icon: "₨" },
  { label: "Audit Trail", href: "/merchant/audit", icon: "◷" },
];

const shopNav: NavItem[] = [
  { label: "AI Commerce", href: "/shop", icon: "✦" },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/merchant" ? pathname === "/merchant" : pathname.startsWith(href);

  return (
    <>
      {/* Overlay for mobile */}
      {open ? <div className="fixed inset-0 z-30 bg-[#0f172a]/40 lg:hidden" onClick={onClose} /> : null}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-[240px] flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]",
          "transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {/* Logo */}
        <div className="flex h-[56px] items-center gap-2 border-b border-[var(--sidebar-border)] px-5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--primary)] text-[13px] font-bold text-white">◆</div>
          <span className="text-[15px] font-semibold tracking-tight">Nimbus Commerce</span>
          <span className="ml-auto rounded bg-[#eff6ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#1e40af]">TEST</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-4">
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Shop</p>
            <ul className="space-y-1">
              {shopNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={[
                      "flex items-center gap-3 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors",
                      isActive(item.href) ? "bg-[#eff6ff] text-[#1e40af]" : "text-[#374151] hover:bg-[#f9fafb] hover:text-[#111827]",
                    ].join(" ")}
                  >
                    <span className="flex h-5 w-5 items-center justify-center text-[12px]">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="mb-4">
            <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">Merchant</p>
            <ul className="space-y-1">
              {merchantNav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={[
                      "flex items-center gap-3 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors",
                      isActive(item.href) ? "bg-[#f3f4f6] text-[#111827] font-semibold" : "text-[#374151] hover:bg-[#f9fafb] hover:text-[#111827]",
                    ].join(" ")}
                  >
                    <span className="flex h-5 w-5 items-center justify-center text-[12px]">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[12px] border border-[var(--border)] bg-[#f8fafc] p-3">
            <p className="text-[12px] font-semibold">AI Growth</p>
            <p className="mt-1 text-[12px] leading-4 text-[var(--muted-foreground)]">Track conversion and AOV uplift — coming in Phase 8</p>
          </div>
        </nav>

        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2 rounded-[8px] bg-[#f9fafb] px-3 py-2.5">
            <div className="h-2 w-2 rounded-full bg-[#0ba36a] animate-pulse" />
            <span className="text-[12px] font-medium">Test Mode</span>
            <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">ON</span>
          </div>
          <div className="mt-3 flex items-center gap-3 px-2">
            <div className="h-7 w-7 rounded-full bg-[#e5e7eb] flex items-center justify-center text-[11px] font-semibold">AD</div>
            <div className="flex flex-col">
              <span className="text-[12px] font-medium leading-none">Aasish Dairel</span>
              <span className="text-[11px] text-[var(--muted-foreground)]">merchant@nimbus.test</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
