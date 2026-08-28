import { CatalogService } from "@/server/catalog";
import { agentTools } from "./tools";
import { isInjectionAttempt, FALLBACK_INJECTION_RESPONSE, SYSTEM_PROMPT, REPLY_PROMPT } from "./prompts";
import { AgentResponse, ShoppingIntentSchema, type ResolvedRecommendation } from "./schemas";
import { conversationStore, extractFactsHeuristic, type ConversationFact } from "./context";
import { groqChatSafe, groqGenerateReplySafe, isGroqConfigured, type GroqMessage } from "./groq";

/**
 * Agent Service — Phase 12 conversational architecture.
 *
 *   user message
 *     ↓
 *   1. Injection defense (regex) — short-circuit if user tries to escape role
 *   2. Context lookup — recall prior facts (budget, category, prefs) for this conversationId
 *   3. Groq intent extraction (when configured) OR heuristic fallback
 *      — Groq NEVER sees prices, never picks productIds, never mutates state
 *      — Groq only returns: intent, query, budgetMax, preferences, category, response
 *   4. Server-side catalog grounding — CatalogService resolves real products
 *   5. Resolve Groq's free-text "query" into real product matches
 *   6. If 0 matches and intent is product_search: ask Groq to clarify
 *   7. Build structured reply, sanitize, never include price/total from LLM
 *
 * SECURITY WALL (enforced by eslint.config.mjs):
 *   - This file MUST NOT import: @/server/checkout, @/server/razorpay, @/server/cart,
 *     @/server/approval, @/server/transaction, @/server/audit, @/app/api/webhooks,
 *     @/lib/prisma, @prisma/client, razorpay, @/generated/prisma.
 *   - Only safe read-only catalog tools are reachable.
 *   - GROQ_API_KEY is server-only and is never returned to the client.
 */

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect a request to mutate cart / approve / pay that is NOT a prompt-injection
 * attempt (e.g. "add the cheaper one to my cart"). The agent cannot do these,
 * but should respond helpfully and point to the UI action rather than ignoring
 * the user.
 */
const ACTION_REQUEST_PATTERN =
  /(?:add|put|throw)\b.*\b(?:to|in(?:to)?)\s+(?:my\s+|the\s+)?(?:cart|bag|basket)|(?:approve|pay|checkout|buy|purchase|place (?:an |the )?order|complete (?:the |my )?purchase)\b/i;

function isActionRequest(text: string): boolean {
  return ACTION_REQUEST_PATTERN.test(text);
}

function actionRequestReply(text: string): string {
  const lower = text.toLowerCase();
  if (/(approve|pay|checkout|buy|purchase|place .*order)/.test(lower)) {
    return "I can't approve a payment or start checkout for you — those are always your explicit actions. When you're happy with a product, hit \u201cAdd to cart\u201d, review it in the cart, then use \u201cApprove & Pay\u201d to continue.";
  }
  return "I can't add items to your cart for you — that's a deliberate safety boundary. Use the \u201cAdd to cart\u201d button on any product card and it will appear in your cart panel on the right.";
}

const MAX_RECOMMENDATIONS = 3;
const MAX_TOOL_CALLS = 6;

type ToolName = keyof typeof agentTools;

interface AgentRequest {
  message: string;
  conversationId?: string;
  requestId?: string;
}

interface AgentResult {
  reply: ReturnType<typeof AgentResponse.parse>;
  toolsUsed: ToolName[];
  latencyMs: number;
  requestId: string;
  conversationId: string;
  llm: "groq" | "heuristic" | "fallback-injection" | "error";
}

function factsToPromptBullets(facts: ConversationFact[]): string {
  if (facts.length === 0) return "  (none)";
  return facts.map((f) => `  - ${f.kind}: ${f.value}`).join("\n");
}

function recentToPromptLines(recent: { role: "user" | "assistant"; text: string }[]): string {
  if (recent.length === 0) return "  (this is the first message)";
  return recent.map((m) => `  ${m.role.toUpperCase()}: ${m.text.slice(0, 250)}`).join("\n");
}

function buildGroqMessages(
  userMessage: string,
  facts: ConversationFact[],
  recent: { role: "user" | "assistant"; text: string }[]
): GroqMessage[] {
  const context = `CONVERSATION FACTS (use to remember prior preferences):
${factsToPromptBullets(facts)}

RECENT MESSAGES (for follow-up interpretation):
${recentToPromptLines(recent)}

USER NOW SAYS:
"""
${userMessage.slice(0, 600)}
"""`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
  ];
}

function formatPriceDisplay(pricePaise: number, currency: string): string {
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(pricePaise / 100).toLocaleString("en-IN")}`;
}

/**
 * Build the second-pass Groq messages used to write a natural, conversational
 * reply AFTER the server has grounded real products. Only server-derived facts
 * are passed (names, server price strings, reasons, availability). The LLM
 * never returns structured productIds/prices — those stay server-authoritative.
 */
function buildReplyMessages(
  request: string,
  resolved: ResolvedRecommendation[]
): GroqMessage[] {
  const lines = resolved.map((r, i) => {
    const status = r.available ? "In stock" : "Currently unavailable";
    return `${i + 1}. ${r.name} — ${formatPriceDisplay(r.price, r.currency)} (${r.category}) • ${status} • ${r.reason}`;
  });
  return [
    { role: "system", content: REPLY_PROMPT.replace("{products}", lines.join("\n")).replace("{request}", request.slice(0, 300)) },
    { role: "user", content: request.slice(0, 300) },
  ];
}

/**
 * Generate the final natural-language reply from server-resolved products.
 * Falls back to the intent response on any failure — never crashes.
 * If the model returns JSON (hostile/loose output), we only accept a plain
 * "message" string and discard everything else (never structured price/IDs).
 */
async function generateNaturalReply(
  request: string,
  resolved: ResolvedRecommendation[],
  intentResponse: string
): Promise<string> {
  try {
    const messages = buildReplyMessages(request, resolved);
    const reply = await groqGenerateReplySafe({ messages, temperature: 0.7, maxTokens: 300 });
    let text = reply.trim();
    // Unwrap JSON-wrapped replies: accept ONLY { message: "..." }
    if (text.startsWith("{") && text.endsWith("}")) {
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
          text = parsed.message.trim();
        } else {
          return intentResponse;
        }
      } catch {
        return intentResponse;
      }
    }
    if (text.length < 10 || text.length > 900) return intentResponse;
    return text;
  } catch {
    return intentResponse;
  }
}

function safeParseIntent(text: string): ReturnType<typeof ShoppingIntentSchema.safeParse> {
  try {
    const trimmed = text.trim();
    // Groq sometimes wraps JSON in ```json fences
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return ShoppingIntentSchema.safeParse({ response: trimmed });
    }
    const candidate = trimmed.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(candidate);
    return ShoppingIntentSchema.safeParse(parsed);
  } catch {
    return ShoppingIntentSchema.safeParse({ response: text });
  }
}

function buildReason(
  product: { name: string; category: string; price: number; features?: string | null; description?: string },
  facts: ConversationFact[],
  intentResponse: string
): string {
  const reasons: string[] = [];
  const budget = facts.find((f) => f.kind === "budget")?.value;
  if (budget) reasons.push(`Within ${budget}`);
  const prefs = facts.filter((f) => f.kind === "preference").slice(0, 2).map((f) => f.value);
  if (prefs.length > 0) reasons.push(prefs.join(", "));
  // Tag a real product attribute — proves the explanation is grounded.
  const nameLower = product.name.toLowerCase();
  const descLower = (product.description ?? "").toLowerCase();
  if (nameLower.includes("anc") || descLower.includes("anc")) reasons.push("ANC");
  if (nameLower.includes("studio") || nameLower.includes("mic")) reasons.push("improves call quality");
  if (nameLower.includes("wireless") || descLower.includes("wireless")) reasons.push("wireless");
  if (nameLower.includes("usb-c") || descLower.includes("usb-c")) reasons.push("USB-C");
  if (reasons.length === 0) {
    reasons.push(`Matches your request in ${product.category}`);
  }
  if (intentResponse) {
    // Append a one-clause hook from the agent's reply
    const firstClause = intentResponse.split(/[.!?]/)[0]?.trim();
    if (firstClause && firstClause.length > 0 && firstClause.length < 60) {
      reasons.push(firstClause.toLowerCase());
    }
  }
  return reasons.slice(0, 2).join(" • ");
}

function confidenceFor(
  product: { price: number; active: boolean; inventory: number },
  facts: ConversationFact[]
): "low" | "medium" | "high" {
  const budget = facts.find((f) => f.kind === "budget");
  if (budget) {
    const n = parseInt(budget.value.replace(/[^\d]/g, ""), 10);
    if (!Number.isNaN(n) && product.price <= n * 100) return "high";
    if (!Number.isNaN(n) && product.price <= n * 100 * 1.1) return "medium";
  }
  if (!product.active || product.inventory === 0) return "low";
  return "medium";
}

export const agentService = {
  async handle(req: AgentRequest): Promise<AgentResult> {
    const start = Date.now();
    const requestId = req.requestId ?? makeId("req");
    const conversationId = req.conversationId ?? "default";
    const toolsUsed: ToolName[] = [];

    const message = req.message?.trim();
    if (!message) {
      const reply = AgentResponse.parse({
        message: "Tell me what you're looking for — e.g. 'headphones under ₹5000 for WFH'.",
        recommendations: [],
      });
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId, llm: "heuristic" };
    }

    // Injection defense — block before any LLM call or DB call
    if (isInjectionAttempt(message)) {
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          requestId,
          conversationId,
          event: "injection_blocked",
          messageLen: message.length,
        })
      );
      const reply = AgentResponse.parse(FALLBACK_INJECTION_RESPONSE);
      return {
        reply,
        toolsUsed,
        latencyMs: Date.now() - start,
        requestId,
        conversationId,
        llm: "fallback-injection",
      };
    }

    // 1. Conversation context
    const conv = conversationStore.get(conversationId) ?? {
      id: conversationId,
      facts: [] as ConversationFact[],
      recent: [] as { role: "user" | "assistant"; text: string; at: number }[],
      updatedAt: Date.now(),
    };
    const newFacts = extractFactsHeuristic(message);
    let updatedConv = conv;
    for (const f of newFacts) {
      updatedConv = conversationStore.upsert(conversationId, { addFact: f });
    }
    updatedConv = conversationStore.upsert(conversationId, {
      addMessage: { role: "user", text: message },
    });

    // 2. Intent extraction
    let intent: ReturnType<typeof ShoppingIntentSchema.parse>;
    let llmUsed: AgentResult["llm"] = "heuristic";
    const FALLBACK_INTENT: ReturnType<typeof ShoppingIntentSchema.parse> = {
      intent: "product_search",
      query: message,
      budgetMax: null,
      preferences: [],
      category: null,
      needsClarification: false,
      clarificationQuestion: "",
      response: isActionRequest(message)
        ? actionRequestReply(message)
        : "Here are a few options from the current catalog.",
    };
    if (isGroqConfigured()) {
      try {
        const messages = buildGroqMessages(message, updatedConv.facts, updatedConv.recent);
        const groqOut = await groqChatSafe({ messages, jsonMode: true, maxTokens: 350 });
        const parsed = safeParseIntent(groqOut.content);
        intent = parsed.success ? parsed.data : FALLBACK_INTENT;
        if (!parsed.success) llmUsed = "heuristic";
        else llmUsed = "groq";
      } catch (e) {
        console.warn(
          JSON.stringify({
            at: new Date().toISOString(),
            requestId,
            conversationId,
            event: "groq_unavailable_fallback",
            error: (e as Error).message,
          })
        );
        intent = FALLBACK_INTENT;
        llmUsed = "heuristic";
      }
    } else {
      // No Groq configured — deterministic intent from facts
      const budget = updatedConv.facts.find((f) => f.kind === "budget")?.value;
      const category = updatedConv.facts.find((f) => f.kind === "category")?.value;
      const n = budget ? parseInt(budget.replace(/[^\d]/g, ""), 10) : NaN;
      const fallbackResponse = isActionRequest(message)
        ? actionRequestReply(message)
        : `Here are a few options from the current catalog. Tell me if you want to narrow it down.`;
      intent = {
        intent: "product_search",
        query: message,
        budgetMax: !Number.isNaN(n) && n > 0 ? n * 100 : null,
        preferences: updatedConv.facts.filter((f) => f.kind === "preference").map((f) => f.value),
        category: category ?? null,
        needsClarification: false,
        clarificationQuestion: "",
        response: fallbackResponse,
      };
    }

    // Persist agent response into context (bounded)
    conversationStore.upsert(conversationId, {
      addMessage: { role: "assistant", text: intent.response },
    });

    // If Groq thinks a clarification is needed and we have nothing to search, return early
    if (intent.needsClarification && (intent.query?.length ?? 0) < 2) {
      const reply = AgentResponse.parse({
        message:
          intent.clarificationQuestion?.length > 0
            ? intent.clarificationQuestion
            : intent.response || "Could you tell me a bit more about what you need?",
        recommendations: [],
      });
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId, llm: llmUsed };
    }

    // 3. Catalog grounding — server-side, never trusts model productIds
    // eslint-disable-next-line prefer-const
    let resolved: ResolvedRecommendation[] = [];
    try {
      toolsUsed.push("recommend_products");
      const budgetPaise =
        typeof intent.budgetMax === "number" && intent.budgetMax > 0
          ? Math.min(intent.budgetMax, 1_000_000)
          : undefined;
      const recs = (await agentTools.recommend_products({
        intent: intent.query || message,
        budgetPaise,
        category: intent.category ?? undefined,
        limit: MAX_RECOMMENDATIONS,
      })) as { productId: string; name: string; category: string; price: number; currency: string; available: boolean }[];

      for (const r of recs) {
        // Verify each ID against the real catalog (no hallucinated IDs)
        const full = await CatalogService.getProduct(r.productId);
        if (!full) continue;
        toolsUsed.push("get_product" as ToolName);
        resolved.push({
          productId: full.id,
          name: full.name,
          category: full.category,
          price: full.price,
          currency: full.currency,
          available: full.active && full.inventory > 0,
          reason: buildReason(full, updatedConv.facts, intent.response),
          confidence: confidenceFor(full, updatedConv.facts),
        });
        if (toolsUsed.length >= MAX_TOOL_CALLS) break;
      }
    } catch (e) {
      console.error(
        JSON.stringify({
          at: new Date().toISOString(),
          requestId,
          event: "recommend_failed",
          error: (e as Error).message,
        })
      );
    }

    // 4. Empty-result handling — natural conversation, not error
    if (resolved.length === 0) {
      let fallbackMessage = intent.response?.length
        ? intent.response
        : "Nothing in the current catalog matches all of those requirements. Want to widen the budget or try a different category?";
      // If we still have a budget and a category, mention "just above" the budget
      const budgetFact = updatedConv.facts.find((f) => f.kind === "budget");
      if (budgetFact) {
        try {
          // Try a slightly higher budget, server-driven
          const n = parseInt(budgetFact.value.replace(/[^\d]/g, ""), 10);
          if (!Number.isNaN(n)) {
            const bumpPaise = Math.round(n * 1.2) * 100;
            const nearby = (await agentTools.recommend_products({
              intent: intent.query || message,
              budgetPaise: bumpPaise,
              category: intent.category ?? undefined,
              limit: 2,
            })) as { productId: string }[];
            for (const r of nearby) {
              const full = await CatalogService.getProduct(r.productId);
              if (!full) continue;
              resolved.push({
                productId: full.id,
                name: full.name,
                category: full.category,
                price: full.price,
                currency: full.currency,
                available: full.active && full.inventory > 0,
                reason: `Slightly above your ${budgetFact.value} budget — close match`,
                confidence: "low",
              });
            }
            if (resolved.length > 0) {
              fallbackMessage = `I couldn't find it under ${budgetFact.value}, but here are a few options just above that range.`;
            }
          }
        } catch {
          // ignore
        }
      }
      const reply = AgentResponse.parse({
        message: fallbackMessage,
        recommendations: [],
      });
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          requestId,
          conversationId,
          event: "no_match",
          toolsUsed,
          llm: llmUsed,
        })
      );
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId, llm: llmUsed };
    }

    // 5. Optional upsell
    const upsell: ResolvedRecommendation[] = [];
    if (resolved.length > 0) {
      try {
        toolsUsed.push("recommend_upsell");
        const up = (await agentTools.recommend_upsell({
          primaryProductId: resolved[0].productId,
        })) as { productId: string } | null;
        if (up) {
          const prod = await CatalogService.getProduct(up.productId);
          if (prod && prod.id !== resolved[0].productId) {
            upsell.push({
              productId: prod.id,
              name: prod.name,
              category: prod.category,
              price: prod.price,
              currency: prod.currency,
              available: prod.active && prod.inventory > 0,
              reason: `Pairs well with ${resolved[0].name.slice(0, 24)}`,
              confidence: "medium",
            });
          }
        }
      } catch {
        // upsell is optional
      }
    }

    // 6. Build reply — strictly the server-derived structured data.
    // The natural-language message is generated from the grounded products when
    // Groq is available; otherwise we keep Groq's intent response.
    const finalMessage =
      llmUsed === "groq" && resolved.length > 0
        ? await generateNaturalReply(message, resolved, intent.response)
        : intent.response;
    const reply = AgentResponse.parse({
      message: finalMessage,
      recommendations: resolved.map((r) => ({
        productId: r.productId,
        reason: r.reason,
        confidence: r.confidence,
      })),
      upsell: upsell.length
        ? upsell.map((r) => ({
            productId: r.productId,
            reason: r.reason,
            confidence: r.confidence,
            isUpsell: true,
          }))
        : undefined,
    });

    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        requestId,
        conversationId,
        event: "recommendation_returned",
        llm: llmUsed,
        toolsUsed,
        recCount: resolved.length,
        latencyMs: Date.now() - start,
      })
    );

    return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId, llm: llmUsed };
  },
};
