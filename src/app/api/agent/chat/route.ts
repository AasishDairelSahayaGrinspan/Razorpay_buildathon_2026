import { NextResponse } from "next/server";
import { ChatRequest } from "@/server/agent/schemas";
import { agentService } from "@/server/agent/agent";

export const dynamic = "force-dynamic";

// Limits per spec
const MAX_MESSAGE_LEN = 1000;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_CONVERSATION_LEN = 20; // not storing history in Phase 3, just validate
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

// Simple in-memory rate limit (per IP, for Phase 3 demo)
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

export async function POST(request: Request) {
  const start = Date.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (!rateLimit(ip)) {
    return NextResponse.json({ error: { code: "RATE_LIMIT", message: "Too many requests" } }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "BAD_JSON", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = ChatRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message, details: parsed.error.issues } },
      { status: 400 }
    );
  }

  const { message, conversationId } = parsed.data;

  if (message.length > MAX_MESSAGE_LEN) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: `Message too long (max ${MAX_MESSAGE_LEN})` } }, { status: 400 });
  }
  if (conversationId.length > 100) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "conversationId too long" } }, { status: 400 });
  }

  // Basic conversation size guard (Phase 3 stateless, but validate)
  // If client sends huge conversation history, we would reject — not applicable now.

  try {
    const result = await agentService.handle({
      message,
      conversationId,
      requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    });

    // Never expose secrets — result is already sanitized
    return NextResponse.json(
      {
        conversationId: result.conversationId,
        reply: result.reply,
        meta: {
          requestId: result.requestId,
          toolsUsed: result.toolsUsed,
          latencyMs: result.latencyMs,
        },
      },
      { status: 200 }
    );
  } catch (e) {
    const latencyMs = Date.now() - start;
    console.error(JSON.stringify({ at: new Date().toISOString(), event: "agent_error", latencyMs, error: (e as Error).message }));
    // Graceful user-facing error, never leak stack/keys
    return NextResponse.json(
      { error: { code: "AGENT_ERROR", message: "Agent is temporarily unavailable. Please try again." } },
      { status: 500 }
    );
  }
}
