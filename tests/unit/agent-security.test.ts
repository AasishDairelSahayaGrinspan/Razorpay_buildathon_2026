import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const agentDir = path.join(process.cwd(), "src/server/agent");

function readFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...readFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("Security wall — agent cannot import Razorpay/payment/prisma", () => {
  const files = readFiles(agentDir);
  const forbiddenPatterns = [
    /from\s+["'].*checkout.*["']/i,
    /from\s+["'].*razorpay.*["']/i,
    /import\s+.*razorpay/i,
    /create_order/i,
    /capture/i,
    /from\s+["']@\/lib\/prisma["']/i,
    /from\s+["']@prisma\/client["']/i,
    /from\s+["'].*generated\/prisma.*["']/i,
    /from\s+["'].*\/cart.*["']/i,
    /CartService/i,
    /approval/i, // agent must not import approval
  ];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const rel = path.relative(process.cwd(), file);
    for (const pat of forbiddenPatterns) {
      // Allow comments mentioning forbidden words for documentation, but not actual imports/calls
      // We check import lines, not every occurrence
      if (pat.source.includes("approval") && content.includes("approval")) {
        // Only fail if it's an import
        const importApproval = /import.*approval/i.test(content);
        if (importApproval) it(`file ${rel} must not import approval`, () => expect(importApproval).toBe(false));
        continue;
      }
      // For create_order/capture, check not in code except test files (these are agent files, should not have)
      if (/create_order|capture/.test(pat.source)) {
        const has = pat.test(content);
        it(`file ${rel} must not contain Razorpay money mutation ${pat.source}`, () => expect(has).toBe(false));
      } else {
        const hasImport = /import\s+.*(?:checkout|razorpay|prisma)/i.test(content) && pat.test(content);
        it(`file ${rel} respects import wall ${pat.source}`, () => expect(hasImport).toBe(false));
      }
    }
  }

  it("agent tools are read-only catalog only", async () => {
    const { agentTools } = await import("@/server/agent/tools");
    const allowed = [
      "search_catalog",
      "get_product",
      "get_product_availability",
      "recommend_products",
      "recommend_upsell",
      "recommend_cross_sell",
      "explain_recommendation",
      "calculate_cart_preview",
    ];
    expect(Object.keys(agentTools).sort()).toEqual(allowed.sort());
    // No Razorpay tools
    expect(Object.keys(agentTools).join(",")).not.toMatch(/razorpay|create_order|payment|checkout/i);
  });
});
