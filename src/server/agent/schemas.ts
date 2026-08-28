import { z } from "zod";

// ── Tool input schemas — strict, bounded ──

export const SearchCatalogInput = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().max(50).optional(),
  minPrice: z.number().int().min(0).max(10_000_00).optional(), // paise, max ₹1L
  maxPrice: z.number().int().min(0).max(10_000_00).optional(),
  limit: z.number().int().min(1).max(10).default(5).optional(),
}).refine((d) => !(d.minPrice !== undefined && d.maxPrice !== undefined && d.minPrice > d.maxPrice), {
  message: "minPrice cannot exceed maxPrice",
});

export const GetProductInput = z.object({
  productId: z.string().min(1).max(100),
});

export const GetAvailabilityInput = z.object({
  productId: z.string().min(1).max(100),
});

export const RecommendProductsInput = z.object({
  intent: z.string().trim().min(1).max(300),
  budgetPaise: z.number().int().min(0).max(10_000_00).optional(),
  category: z.string().trim().max(50).optional(),
  limit: z.number().int().min(1).max(5).default(3).optional(),
});

export const RecommendUpsellInput = z.object({
  primaryProductId: z.string().min(1).max(100),
});

export const RecommendCrossSellInput = z.object({
  primaryProductId: z.string().min(1).max(100),
  limit: z.number().int().min(1).max(3).default(2).optional(),
});

export const ExplainRecommendationInput = z.object({
  productId: z.string().min(1).max(100),
  intent: z.string().trim().min(1).max(300).optional(),
});

export const CalculateCartPreviewInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(100),
        quantity: z.number().int().min(1).max(10),
      })
    )
    .min(1)
    .max(10),
});

// ── Structured agent output — price/totals NEVER from LLM ──

export const RecommendationItem = z.object({
  productId: z.string(),
  reason: z.string().min(1).max(300),
  confidence: z.enum(["low", "medium", "high"]),
  isUpsell: z.boolean().optional().default(false),
});

export const AgentResponse = z.object({
  message: z.string().min(1).max(1000),
  recommendations: z.array(RecommendationItem).max(5).default([]),
  upsell: z.array(RecommendationItem).max(2).default([]).optional(),
  crossSell: z.array(RecommendationItem).max(3).default([]).optional(),
  // Quantity proposals are bounded, price/total NEVER here — backend owns it
  cartPreview: z
    .object({
      items: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10) })),
      // No amount/total fields — backend calculates
    })
    .optional(),
});

export type AgentResponseType = z.infer<typeof AgentResponse>;

// ── Chat API schemas ──

export const ChatRequest = z.object({
  message: z.string().trim().min(1).max(1000),
  conversationId: z.string().trim().max(100).optional().default("default"),
});

// ── Phase 12: Groq structured shopping intent ──
// What the LLM is allowed to say. We deliberately exclude: price, total,
// productId, inventory, payment status, secret-ish fields. The model only
// expresses user intent and natural-language response; product resolution is
// always server-driven against the real catalog.

export const ShoppingIntentSchema = z.object({
  intent: z.enum(["product_search", "clarification", "general", "followup"]),
  query: z.string().max(200).default(""),
  // We deliberately allow very large budgetMax from the LLM and clamp at the
  // agent layer (see agent.ts) so Zod never drops a valid conversational
  // response on a numeric edge case.
  budgetMax: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  preferences: z.array(z.string().min(1).max(80)).max(8).default([]),
  category: z.string().max(50).nullable().default(null),
  needsClarification: z.boolean().default(false),
  clarificationQuestion: z.string().max(200).default(""),
  response: z.string().min(1).max(800),
});
export type ShoppingIntent = z.infer<typeof ShoppingIntentSchema>;

// ── Phase 12: resolved recommendation (after server-side grounding) ──

export const ResolvedRecommendationSchema = z.object({
  productId: z.string(),
  name: z.string(),
  category: z.string(),
  price: z.number().int(), // paise, server authoritative
  currency: z.string().default("INR"),
  available: z.boolean(),
  reason: z.string().min(1).max(300),
  confidence: z.enum(["low", "medium", "high"]),
});
export type ResolvedRecommendation = z.infer<typeof ResolvedRecommendationSchema>;

export const ChatResponse = z.object({
  conversationId: z.string(),
  reply: AgentResponse,
  meta: z.object({
    requestId: z.string(),
    toolsUsed: z.array(z.string()),
    latencyMs: z.number(),
  }),
});
