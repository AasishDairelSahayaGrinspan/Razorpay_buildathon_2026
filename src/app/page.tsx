import Link from "next/link";
import { Badge } from "@/components/ui/badge";

const pillarSections = [
  {
    title: "AI-powered shopping",
    body: "A conversational assistant that understands what you are shopping for, searches the real catalog, and recommends products with explainable reasons — grounded in server data, never invented.",
  },
  {
    title: "Merchant catalog",
    body: "A server-side catalog with integer paise pricing. Products, prices, currency, and inventory are authoritative on the server; the browser and the AI can read them but never redefine them.",
  },
  {
    title: "Conversational product discovery",
    body: "Ask in natural language — budget, category, preferences. The agent remembers context within the chat and refines results, then points you to the exact product cards.",
  },
  {
    title: "Cart and deterministic pricing",
    body: "Adding to cart happens only when you click it. Prices are always re-read from the catalog at cart time — the cart never accepts a client-supplied price.",
  },
  {
    title: "Approval and policy controls",
    body: "Before any payment intent, the cart passes a server-side policy check. Approval is an explicit user action and is recorded as part of the transaction trail.",
  },
  {
    title: "Razorpay TEST checkout",
    body: "Checkout uses Razorpay in TEST mode. Orders, amounts, and keys are created server-side only; the client never decides how much to charge.",
  },
  {
    title: "Payment verification & webhooks",
    body: "The server verifies every payment signature with HMAC and validates Razorpay webhooks with a shared secret — tampered or unexpected events are rejected and audited.",
  },
  {
    title: "Failure / retry / UNKNOWN handling",
    body: "The transaction state machine handles failures, retries, and unknown outcomes gracefully — nothing is silently lost, and every transition is recorded.",
  },
  {
    title: "Idempotency",
    body: "Duplicate webhooks and repeated actions are handled idempotently, so retries never double-charge or corrupt transaction state.",
  },
  {
    title: "Immutable audit trail",
    body: "Every meaningful action — cart, approval, order, verification, webhook — is appended to an immutable audit log you can inspect in the merchant area.",
  },
  {
    title: "Security boundaries",
    body: "The AI agent is sandboxed to read-only catalog tools. It cannot create carts, approve transactions, place Razorpay orders, or mutate payment state — those are always explicit user actions.",
  },
];

export const metadata = {
  title: "Nimbus Commerce — AI-powered shopping with Razorpay Test Mode",
  description:
    "A demo of agentic commerce: a conversational AI shopping assistant, deterministic server pricing, approval workflow, policy checks, Razorpay TEST checkout, HMAC payment verification, webhooks, and an immutable audit trail.",
};

export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 py-10 lg:py-16 flex flex-col gap-12">
      {/* Hero */}
      <section className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary)] text-white text-[18px]">◆</div>
          <span className="text-[20px] font-semibold tracking-tight">Nimbus Commerce</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Razorpay TEST mode</Badge>
          <Badge variant="info">Agentic Commerce</Badge>
        </div>
        <h1 className="max-w-[720px] text-[32px] leading-[1.15] font-semibold tracking-tight sm:text-[40px]">
          Shopping, guided by AI — priced and secured by the server.
        </h1>
        <p className="max-w-[560px] text-[15px] leading-6 text-[var(--muted-foreground)]">
          Ask the assistant for what you need, review grounded recommendations, and complete a Razorpay TEST
          checkout with server-side verification and a full audit trail.
        </p>
        <Link
          href="/shop"
          className="inline-flex h-12 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)] px-7 text-[15px] font-semibold text-white shadow-[var(--shadow-button)] transition-colors hover:bg-[var(--primary-hover)]"
        >
          Shop with AI
        </Link>
        <p className="text-[12px] text-[var(--muted-foreground)]">
          Read-only recommendations · you approve every payment · TEST mode only
        </p>
      </section>

      {/* Feature grid */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Features">
        {pillarSections.map((s) => (
          <div key={s.title} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow-card)]">
            <h2 className="text-[14px] font-semibold tracking-tight">{s.title}</h2>
            <p className="mt-2 text-[13px] leading-5 text-[var(--muted-foreground)]">{s.body}</p>
          </div>
        ))}
      </section>

      {/* Flow */}
      <section className="flex flex-col items-center gap-4 text-center">
        <h2 className="text-[22px] font-semibold tracking-tight">How the flow works</h2>
        <p className="max-w-[640px] text-[14px] leading-6 text-[var(--muted-foreground)]">
          You —→ AI assistant —→ read-only catalog tools —→ cart —→ approval & policy —→ Razorpay TEST checkout —→
          server-side verification & webhooks —→ transaction state —→ audit trail.
        </p>
        <Link
          href="/shop"
          className="mt-2 inline-flex h-12 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary)] px-7 text-[15px] font-semibold text-white shadow-[var(--shadow-button)] transition-colors hover:bg-[var(--primary-hover)]"
        >
          Shop with AI
        </Link>
      </section>

      <footer className="border-t border-[var(--border)] pt-6 text-center text-[12px] text-[var(--muted-foreground)]">
        Nimbus Commerce — Razorpay TEST-mode demonstration. No real money is processed.
      </footer>
    </div>
  );
}
