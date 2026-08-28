// Phase 12 — in-memory bounded conversation context
// Session-only. Not persisted. Not shared across processes. Cleared on server
// restart. Per-conversationId, we keep the last N "facts" the user has shared
// (budget, preferences, category). The agent reasons over the current message
// plus the recent facts to produce a coherent conversational experience.
//
// SECURITY: This module stores only short strings extracted from the user
// message and prior agent responses. It never stores raw user messages, API
// keys, payment info, or Razorpay details. TTL is 30 minutes; max 8 facts per
// conversation; max 1000 active conversations in memory.

import { z } from "zod";

const MAX_CONVERSATIONS = 1000;
const MAX_FACTS_PER_CONVERSATION = 8;
const TTL_MS = 30 * 60 * 1000;

export const ConversationFactSchema = z.object({
  kind: z.enum(["budget", "category", "preference", "use_case", "followup"]),
  value: z.string().min(1).max(200),
  at: z.number(),
});
export type ConversationFact = z.infer<typeof ConversationFactSchema>;

const ConversationSchema = z.object({
  id: z.string().min(1).max(100),
  facts: z.array(ConversationFactSchema).max(MAX_FACTS_PER_CONVERSATION),
  updatedAt: z.number(),
  // Rolling tail of last 4 messages for follow-up interpretation.
  // Strings only, max 500 chars each. Never persisted.
  recent: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        text: z.string().max(500),
        at: z.number(),
      })
    )
    .max(4),
});
type Conversation = z.infer<typeof ConversationSchema>;

const store = new Map<string, Conversation>();

function gc(): void {
  const now = Date.now();
  for (const [id, conv] of store.entries()) {
    if (now - conv.updatedAt > TTL_MS) store.delete(id);
  }
  // Cap total
  if (store.size > MAX_CONVERSATIONS) {
    const sorted = Array.from(store.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    const toRemove = sorted.slice(0, store.size - MAX_CONVERSATIONS);
    for (const [id] of toRemove) store.delete(id);
  }
}

export const conversationStore = {
  get(id: string): Conversation | null {
    gc();
    return store.get(id) ?? null;
  },

  upsert(id: string, patch: { addFact?: ConversationFact; addMessage?: { role: "user" | "assistant"; text: string } }): Conversation {
    gc();
    const existing = store.get(id) ?? {
      id,
      facts: [],
      recent: [],
      updatedAt: Date.now(),
    };
    if (patch.addFact) {
      // Replace same-kind facts to keep the set small
      existing.facts = existing.facts.filter((f) => f.kind !== patch.addFact!.kind);
      existing.facts.push(patch.addFact);
      if (existing.facts.length > MAX_FACTS_PER_CONVERSATION) {
        existing.facts = existing.facts.slice(-MAX_FACTS_PER_CONVERSATION);
      }
    }
    if (patch.addMessage) {
      // Truncate to keep recent messages bounded
      const truncated: { role: "user" | "assistant"; text: string; at: number } = {
        ...patch.addMessage,
        text: patch.addMessage.text.length > 500 ? patch.addMessage.text.slice(0, 500) : patch.addMessage.text,
        at: Date.now(),
      };
      existing.recent.push(truncated);
      if (existing.recent.length > 4) existing.recent = existing.recent.slice(-4);
    }
    existing.updatedAt = Date.now();
    const parsed = ConversationSchema.parse(existing);
    store.set(id, parsed);
    return parsed;
  },

  clear(id: string): void {
    store.delete(id);
  },

  // Test helpers
  _reset(): void {
    store.clear();
  },
  _size(): number {
    return store.size;
  },
};

/**
 * Heuristic fact extraction from a single user message.
 * Used as a fallback when Groq is unavailable. Server-side only.
 */
export function extractFactsHeuristic(message: string): ConversationFact[] {
  const facts: ConversationFact[] = [];
  const lower = message.toLowerCase();
  const now = Date.now();

  // Budget
  const budgetMatch = lower.match(/(?:under|below|within|budget)\s*₹?\s*([\d,]+)/i);
  if (budgetMatch) {
    const n = parseInt(budgetMatch[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(n) && n > 0) {
      facts.push({ kind: "budget", value: `₹${n}`, at: now });
    }
  }
  // Category
  if (/(headphone|earphone|earbud|audio|mic|microphone|headset)/.test(lower)) {
    facts.push({ kind: "category", value: "Audio", at: now });
  } else if (/(webcam|camera|keyboard|mouse|monitor|stand|hub|dock|adapter)/.test(lower)) {
    facts.push({ kind: "category", value: "Peripherals", at: now });
  } else if (/(cable|charger|light)/.test(lower)) {
    facts.push({ kind: "category", value: "Accessories", at: now });
  }
  // Use case
  if (/(wfh|work from home|home office|remote work|office)/.test(lower)) {
    facts.push({ kind: "use_case", value: "WFH", at: now });
  } else if (/(gaming|game|gamer)/.test(lower)) {
    facts.push({ kind: "use_case", value: "gaming", at: now });
  } else if (/(stud(y|io)|recording|podcast|streaming|content)/.test(lower)) {
    facts.push({ kind: "use_case", value: "studio", at: now });
  }
  // Preferences
  const prefKeywords = [
    "noise cancellation",
    "anc",
    "wireless",
    "bluetooth",
    "usb-c",
    "compact",
    "portable",
    "lightweight",
    "cheap",
    "budget",
    "premium",
    "high quality",
  ];
  for (const k of prefKeywords) {
    if (lower.includes(k)) {
      facts.push({ kind: "preference", value: k, at: now });
    }
  }
  return facts;
}
