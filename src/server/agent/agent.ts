import { CatalogService } from "@/server/catalog";
import { agentTools } from "./tools";
import { isInjectionAttempt, FALLBACK_INJECTION_RESPONSE } from "./prompts";
import { AgentResponse } from "./schemas";

/**
 * Agent Service — deterministic, recommendation-only
 * No Razorpay, no checkout, no Prisma direct, no cart mutation
 * UI → POST /api/agent/chat → agentService.handle → tools → CatalogService
 */

// Simple in-memory correlation id generator (deterministic enough for Phase 3)
function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
}

// Extract budget from text like "under 5000", "under ₹5,000", "5000"
function parseBudgetPaise(text: string): number | undefined {
  const m = text.match(/(?:under|below|within|budget)\s*₹?\s*([\d,]+)/i) ?? text.match(/₹\s*([\d,]+)/);
  if (m) {
    const num = parseInt(m[1].replace(/,/g, ""), 10);
    if (!Number.isNaN(num) && num > 0 && num <= 100000) {
      return num * 100; // rupees to paise
    }
  }
  // Also detect plain "5000" in context of headphones
  const plain = text.match(/\b(\d{3,5})\b/);
  if (plain) {
    const n = parseInt(plain[1], 10);
    if (n >= 500 && n <= 100000) return n * 100;
  }
  return undefined;
}

function inferCategory(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/(headphone|earphone|audio|mic|microphone)/.test(t)) return "Audio";
  if (/(webcam|camera|keyboard|mouse|monitor)/.test(t)) return "Peripherals";
  if (/(stand|hub|dock|adapter)/.test(t)) return "Accessories";
  return undefined;
}

function buildReason(product: { name: string; category: string; price: number }, intent: string, budgetPaise?: number): string {
  const reasons: string[] = [];
  if (budgetPaise !== undefined && product.price <= budgetPaise) reasons.push(`Within ₹${budgetPaise / 100} budget`);
  if (/wfh|work from home|work.*home|office/.test(intent.toLowerCase())) {
    if (product.category === "Audio") reasons.push("Suitable for WFH calls");
    else reasons.push(`For ${product.category.toLowerCase()} setup`);
  }
  // Use actual product name hint
  if (product.name.toLowerCase().includes("anc")) reasons.push("ANC for focus");
  if (product.name.toLowerCase().includes("studio") || product.name.toLowerCase().includes("microphone")) reasons.push("Improves call quality");
  if (reasons.length === 0) reasons.push(`Matches your request in ${product.category}`);
  return reasons.slice(0, 2).join(" • ");
}

export const agentService = {
  async handle(req: AgentRequest): Promise<AgentResult> {
    const start = Date.now();
    const requestId = req.requestId ?? makeId("req");
    const conversationId = req.conversationId ?? "default";
    const toolsUsed: ToolName[] = [];

    // Empty / invalid
    const message = req.message?.trim();
    if (!message) {
      const reply = AgentResponse.parse({
        message: "Tell me what you're looking for — e.g. 'headphones under ₹5000 for WFH'.",
        recommendations: [],
      });
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId };
    }

    // Injection defense
    if (isInjectionAttempt(message)) {
      // Log safe event (no secrets)
      console.log(JSON.stringify({ at: new Date().toISOString(), requestId, conversationId, event: "injection_blocked", messageLen: message.length }));
      const reply = AgentResponse.parse(FALLBACK_INJECTION_RESPONSE);
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId };
    }

    // Deterministic recommendation flow (no external LLM)
    const budgetPaise = parseBudgetPaise(message);
    const category = inferCategory(message);

    // Tool 1: recommend_products (wraps search_catalog + ranking)
    const recommendations: { productId: string; reason: string; confidence: "low" | "medium" | "high" }[] = [];
    try {
      toolsUsed.push("recommend_products");
      const recs = (await agentTools.recommend_products({
        intent: message,
        budgetPaise,
        category,
        limit: MAX_RECOMMENDATIONS,
      })) as { productId: string; name: string; category: string; price: number }[];

      // Validate every productId is real (already from DB) and build reasons from server data
      for (const r of recs) {
        // Double-check exists via get_product (ensures no hallucination)
        const prod = await CatalogService.getProduct(r.productId);
        if (!prod) continue; // skip hallucinated (should never happen)
        toolsUsed.push("get_product" as ToolName);
        recommendations.push({
          productId: r.productId,
          reason: buildReason({ name: prod.name, category: prod.category, price: prod.price }, message, budgetPaise),
          confidence: prod.price <= (budgetPaise ?? Infinity) ? "high" : "medium",
        });
        if (toolsUsed.length >= MAX_TOOL_CALLS) break;
      }
    } catch (e) {
      console.error(JSON.stringify({ at: new Date().toISOString(), requestId, event: "recommend_failed", error: (e as Error).message }));
    }

    // Tool 2: upsell/cross-sell for first recommendation
    const upsell: typeof recommendations = [];
    const crossSell: typeof recommendations = [];
    if (recommendations.length > 0) {
      const primaryId = recommendations[0].productId;
      try {
        toolsUsed.push("recommend_upsell");
        const up = (await agentTools.recommend_upsell({ primaryProductId: primaryId })) as { productId: string; name: string } | null;
        if (up) {
          const prod = await CatalogService.getProduct(up.productId);
          if (prod) {
            upsell.push({
              productId: up.productId,
              reason: `Complements ${recommendations[0].productId.slice(0, 6)} — improves setup`,
              confidence: "medium",
            });
          }
        }
      } catch {}
      try {
        toolsUsed.push("recommend_cross_sell");
        const cross = (await agentTools.recommend_cross_sell({ primaryProductId: primaryId, limit: 2 })) as { productId: string }[];
        for (const c of cross.slice(0, 2)) {
          const prod = await CatalogService.getProduct(c.productId);
          if (!prod) continue;
          crossSell.push({
            productId: c.productId,
            reason: `Pairs well with your pick — ${prod.category}`,
            confidence: "low",
          });
        }
      } catch {}
    }

    // Handle empty catalog satisfy
    if (recommendations.length === 0) {
      const reply = AgentResponse.parse({
        message: "Nothing in the current catalog matches all of those requirements. Try a broader search like 'headphones for work' or increase your budget.",
        recommendations: [],
        upsell: [],
        crossSell: [],
      });
      console.log(JSON.stringify({ at: new Date().toISOString(), requestId, conversationId, event: "no_match", toolsUsed }));
      return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId };
    }

    // Build final structured message — never include price/total (backend will add)
    const messageText =
      budgetPaise !== undefined
        ? `Found ${recommendations.length} option(s) within ₹${budgetPaise / 100} for "${message.slice(0, 60)}".`
        : `Here are ${recommendations.length} recommendations for "${message.slice(0, 60)}".`;

    const reply = AgentResponse.parse({
      message: messageText,
      recommendations,
      upsell,
      crossSell,
    });

    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        requestId,
        conversationId,
        event: "recommendation_returned",
        toolsUsed,
        recCount: recommendations.length,
        latencyMs: Date.now() - start,
      })
    );

    return { reply, toolsUsed, latencyMs: Date.now() - start, requestId, conversationId };
  },
};
