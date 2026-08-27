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

export const ChatResponse = z.object({
  conversationId: z.string(),
  reply: AgentResponse,
  meta: z.object({
    requestId: z.string(),
    toolsUsed: z.array(z.string()),
    latencyMs: z.number(),
  }),
});
