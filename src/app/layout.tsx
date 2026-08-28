import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Nimbus Commerce — AI-powered shopping with Razorpay Test Mode",
    template: "%s — Nimbus Commerce",
  },
  description:
    "A demo of agentic commerce: a conversational AI shopping assistant, deterministic server pricing, approval workflow, policy checks, Razorpay TEST checkout, HMAC payment verification, webhooks, and an immutable audit trail.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Nimbus Commerce — AI-powered shopping",
    description:
      "Conversational AI shopping assistant with deterministic server pricing and a Razorpay TEST checkout flow.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
