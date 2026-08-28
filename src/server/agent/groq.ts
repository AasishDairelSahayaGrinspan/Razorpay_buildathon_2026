// Phase 12 — server-only Groq client
// OpenAI-compatible Chat Completions API used via fetch (no extra dependency).
// The agent security wall (eslint.config.mjs) forbids any direct import of
// Razorpay, checkout, prisma, cart, approval, transaction, audit, webhook, and
// generated/prisma from src/server/agent/**. This module is the ONLY place in
// the application that talks to Groq.

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export type GroqMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GroqChatInput = {
  messages: GroqMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  // Force JSON object output (Groq supports response_format: { type: "json_object" })
  jsonMode?: boolean;
  signal?: AbortSignal;
};

export type GroqChatResult = {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
};

// Current supported Groq conversational model (Llama 4 Maverick).
// Overridable via GROQ_MODEL env var for testing/demo.
const DEFAULT_MODEL = process.env.GROQ_MODEL ?? "meta-llama/llama-4-maverick-17b-128e-instruct";
const REQUEST_TIMEOUT_MS = 8_000;

function getApiKey(): string | null {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.trim().length === 0) return null;
  return key.trim();
}

function isFakeKey(key: string): boolean {
  // Detect placeholder/example keys so the app degrades gracefully in tests
  return key.startsWith("gsk_...") || key === "test" || key.length < 10;
}

/**
 * Call Groq Chat Completions. Throws on missing key, timeout, network error,
 * or non-2xx. Never returns the API key. Returns sanitized content.
 */
export async function groqChat(input: GroqChatInput): Promise<GroqChatResult> {
  const apiKey = getApiKey();
  if (!apiKey || isFakeKey(apiKey)) {
    throw Object.assign(new Error("GROQ_API_KEY missing or placeholder"), {
      code: "GROQ_KEY_MISSING",
    });
  }
  const model = input.model ?? DEFAULT_MODEL;
  const body: Record<string, unknown> = {
    model,
    messages: input.messages,
    temperature: input.temperature ?? 0.4,
    max_tokens: input.maxTokens ?? 400,
    stream: false,
  };
  if (input.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = input.signal ?? controller.signal;

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`Groq API error: ${res.status}`), {
        code: res.status === 429 ? "GROQ_RATE_LIMIT" : "GROQ_API_ERROR",
        status: res.status,
        body: text.slice(0, 500),
      });
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    if (!content) {
      throw Object.assign(new Error("Groq returned empty content"), { code: "GROQ_EMPTY" });
    }
    return {
      content,
      model: data.model ?? model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      throw Object.assign(new Error("Groq request timed out"), { code: "GROQ_TIMEOUT" });
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns true if Groq is configured with a real-looking key, OR a test stub
 * is installed. Server-only — never trust client to know this.
 */
export function isGroqConfigured(): boolean {
  if (_stubbedChat) return true;
  const key = getApiKey();
  return !!key && !isFakeKey(key);
}

/**
 * Test seam — allow unit tests to stub out the chat function. Server-only.
 */
let _stubbedChat: ((input: GroqChatInput) => Promise<GroqChatResult>) | null = null;
export function __setGroqChatStub(
  stub: ((input: GroqChatInput) => Promise<GroqChatResult>) | null
): void {
  _stubbedChat = stub;
}

export async function groqChatSafe(input: GroqChatInput): Promise<GroqChatResult> {
  if (_stubbedChat) return _stubbedChat(input);
  return groqChat(input);
}

/**
 * Reply-generation seam (Phase 12A): separate from the intent stub so existing
 * tests that only stub intent extraction keep working. When no reply stub is
 * installed, this falls through to the real Groq client (which degrades to the
 * heuristic fallback in agent.ts if Groq is unavailable).
 */
let _stubbedReply: ((input: GroqChatInput) => Promise<string>) | null = null;
export function __setGroqReplyStub(
  stub: ((input: GroqChatInput) => Promise<string>) | null
): void {
  _stubbedReply = stub;
}

export async function groqGenerateReplySafe(input: GroqChatInput): Promise<string> {
  if (_stubbedReply) return _stubbedReply(input);
  // Test mode (intent stub installed but no reply stub): never hit the live
  // Groq API — the agent falls back to the intent response instead.
  if (_stubbedChat) {
    throw Object.assign(new Error("No reply stub installed (test mode)"), {
      code: "GROQ_KEY_MISSING",
    });
  }
  const result = await groqChat(input);
  return result.content.trim();
}
