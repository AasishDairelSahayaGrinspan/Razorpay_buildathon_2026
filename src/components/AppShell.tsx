"use client";

import * as React from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-[240px]">
        <TopBar onMenuClick={() => setOpen((v) => !v)} />
        <main className="min-h-[calc(100vh-56px)]">{children}</main>
      </div>
    </div>
  );
}
