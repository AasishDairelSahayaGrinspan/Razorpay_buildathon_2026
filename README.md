# Nimbus Commerce — AI-powered Shopping with Razorpay Test Mode

## Overview

Nimbus Commerce is a full-stack demonstration of agentic commerce: a conversational AI shopping assistant that helps a customer find products, alongside a merchant catalog, a deterministic cart and pricing engine, an approval and policy workflow, a Razorpay TEST checkout, server-side payment verification, webhook handling, and an immutable audit trail.

The project demonstrates a realistic separation of concerns: the AI agent is deliberately sandboxed to read-only catalog tools. It can recommend products, explain matches, and remember conversational context, but it cannot create carts, approve transactions, place Razorpay orders, or mutate payment state. Every money-related action is an explicit user action backed by server-side checks.

This is a Razorpay TEST-mode demonstration, not a production payment deployment. No real money is processed.

## Features

- **AI shopping assistant** — a conversational agent (powered by Groq) that understands natural-language requests, remembers context within a chat, and recommends products with explainable reasons.
- **Merchant catalog** — a server-side catalog with integer paise pricing. Products, prices, currency, and inventory are authoritative on the server.
- **Deterministic cart and pricing** — the cart re-reads prices from the catalog; it never accepts a client-supplied price. Prices are always shown from server data.
- **Approval workflow** — adding to cart and approving a transaction are explicit user actions.
- **Policy engine** — before payment intent, the cart passes a server-side policy check (policy:passed/total reported in the UI).
- **Razorpay TEST checkout** — checkout uses Razorpay in TEST mode. Orders and amounts are created server-side only.
- **HMAC payment verification** — the server verifies every payment signature using SHA-256 HMAC; the frontend callback is never trusted on its own.
- **Webhook verification** — Razorpay webhooks are validated with a shared secret and drive authoritative payment state.
- **Failure / retry / UNKNOWN handling** — the transaction state machine handles failed, retried, and unknown outcomes gracefully.
- **Idempotency** — duplicate webhooks and repeated actions are handled idempotently.
- **Immutable audit trail** — every meaningful action is appended to an audit log viewable in the merchant area.
- **Security boundaries** — the AI agent is sandboxed to read-only catalog tools and cannot import or access payment, cart-mutation, approval, or state-machine modules.

## Architecture

The primary flow is:

```
User
  → AI shopping assistant
  → read-only catalog tools (search, get, availability, recommend)
  → cart (explicit user add)
  → approval + policy checks (explicit user action)
  → checkout (Razorpay TEST order, server-created)
  → Razorpay
  → server-side HMAC verification / webhook
  → transaction state machine
  → immutable audit trail
```

The AI agent can recommend and explain, but it **cannot directly**:

- create or approve carts
- create Razorpay orders
- perform checkout
- capture payments
- refund payments
- mutate payment state

Approval and checkout are always explicit user actions in the UI.

## Tech Stack

- **Next.js** (App Router) — React framework
- **React 19** — UI
- **TypeScript** — language
- **Tailwind CSS v4** — styling
- **Prisma** (SQLite) — data layer
- **Razorpay SDK** — Razorpay TEST orders and verification
- **Groq** (OpenAI-compatible Chat Completions API) — conversational AI
- **Zod** — schema validation
- **Vitest** — unit tests
- **Playwright** — end-to-end tests
- **ESLint** — linting

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
  - `page.tsx` — landing page
  - `shop/page.tsx` — the AI shopping experience
  - `merchant/` — merchant overview, products, orders, payments, audit trail
  - `api/` — REST endpoints (agent, cart, approval, checkout, products, webhooks, audit)
- `src/components/` — React UI components (AppShell, Sidebar, TopBar, ProductCard, ShopChat, UI primitives)
- `src/server/` — server-only logic
  - `agent/` — the AI agent (Groq client, prompts, context, schemas, tools)
  - `catalog.ts` — catalog service
  - `cart.ts` — cart service
  - `approval/` — approval and policy engine
  - `checkout/` — checkout order + verification service
  - `transaction/stateMachine.ts` — the transaction state machine
  - `audit/` — audit service
  - `razorpay/` — Razorpay client
- `prisma/` — Prisma schema, migrations, and seed
- `tests/` — unit tests (`tests/unit`) and end-to-end tests (`tests/e2e`)

## Transaction / Payment State Machine

The transaction state machine (`src/server/transaction/stateMachine.ts`) enforces valid transitions. Important states:

- `DRAFT` → `CART_READY` → `APPROVAL_PENDING` → `APPROVED`
- `APPROVED` → `ORDER_CREATED` → `PAYMENT_PENDING`
- `PAYMENT_PENDING` / `PAYMENT_PROCESSING` → `PAYMENT_SUCCESS` | `PAYMENT_FAILED` | `PAYMENT_UNKNOWN`
- `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, and `PAYMENT_UNKNOWN` are terminal.

`PAYMENT_UNKNOWN` never automatically converts to `PAYMENT_SUCCESS`. Terminal states cannot be transitioned out of. Every transition is validated and recorded in the audit trail.

## Security

- **Server-authoritative pricing** — prices are integers in paise stored on the server; the browser and the AI cannot redefine them.
- **HMAC verification** — payment verification uses SHA-256 HMAC with the Razorpay key secret, server-side only.
- **Webhook signature verification** — webhooks are validated against a shared secret; tampered payloads (including whitespace changes) are rejected.
- **Secret handling** — `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `GROQ_API_KEY` are read only on the server and are never returned to the browser.
- **Agent security wall** — an ESLint `no-restricted-imports` rule (and a unit test) prevent the agent from importing checkout, Razorpay, cart, approval, transaction, audit, webhook, and Prisma modules.
- **Prompt-injection protections** — the agent has injection-pattern detection and a hard fallback response; attempts to reveal secrets, change prices, create payments, or bypass restrictions are blocked before any model call.
- **Input validation** — all API inputs are validated with Zod (including the 1000-character message limit and cart quantity bounds).
- **Rate limiting** — the agent chat endpoint rate-limits per client; the production limit is strict, while local development uses a higher ceiling so the parallel E2E suite stays deterministic.
- **Idempotency** — duplicate webhooks and repeated actions are handled idempotently (unique constraints on cart hash and Razorpay IDs).

## Environment Variables

Required variables (see `.env.example` for the full template — never commit a real `.env`):

```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=whsec_...
GROQ_API_KEY=gsk_...
GROQ_MODEL=meta-llama/llama-4-maverick-17b-128e-instruct
DATABASE_URL=file:./dev.db
```

Use your own Razorpay TEST credentials and Groq API key. Never commit real values.

## Local Development

Prerequisites: Node.js, npm.

Install dependencies:

```bash
npm install
```

Configure environment: copy `.env.example` to `.env` and fill in real TEST credentials.

Generate the Prisma client:

```bash
npx prisma generate
```

Sync the development database and seed the catalog:

```bash
npx prisma db push
npx tsx prisma/seed.ts
```

Run the development server:

```bash
npm run dev
```

Open http://localhost:3000.

## Testing

Run lint:

```bash
npm run lint
```

Run unit tests (Vitest):

```bash
npx vitest run
```

Run a production build:

```bash
npm run build
```

Run end-to-end tests (Playwright, 2 workers):

```bash
npx playwright test --workers=2
```

Verified baseline: 281/281 unit tests passing, 282/282 Playwright tests passing, ESLint clean, build succeeding.

## Demo Flow

1. Open the landing page.
2. Click "Shop with AI" to enter the shop.
3. Ask the shopping assistant for a product (e.g. "headphones under ₹5000 for WFH").
4. Review the grounded recommendation and its reason.
5. Add a product to the cart.
6. Approve the cart (policy checks run server-side).
7. Open the Razorpay TEST checkout.
8. Complete the test payment.
9. Verify the server-side payment (HMAC + webhook).
10. Open merchant Orders / Payments to see the transaction.
11. Open the Audit Trail to see the immutable history.
12. Demonstrate the explainable transaction history and state transitions.

## Build Challenges & Technical Obstacles

The biggest challenge was making the AI shopping flow, Razorpay checkout, webhooks, and payment states work together without letting the AI directly control payments.

I also had to deal with stale cart data, payment verification, webhook signatures, idempotency, mobile UI issues, and flaky E2E tests.

At one point, everything broke at 2 AM. I drank a Red Bull, gave the problem to the coding agents, and somehow we survived. 

We fixed the issues by:

- Using server-side price validation instead of trusting the AI or browser.
- Using Razorpay Test Mode APIs for order creation and payment verification.
- Adding HMAC signature verification for payments and webhooks.
- Building a strict transaction state machine for success, failure, and unknown states.
- Adding idempotency and retry handling for duplicate requests and Razorpay failures.
- Using Playwright + Vitest extensively to catch regressions.
- Adding security boundaries so the AI agent cannot create carts, approve payments, create Razorpay orders, or access payment secrets.

## Limitations / Scope

This is a Razorpay TEST-mode demonstration and is not a production payment deployment. It does not implement real-money capture, refunds, subscriptions, payouts, or production-grade identity/security. The database is a local SQLite file and conversation context is in-memory. Groq is used for conversational intent and reply generation only; all prices, product IDs, and payment state remain server-authoritative.
