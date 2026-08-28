import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Phase 3-6 security wall: agent must not import checkout/razorpay/prisma/cart/approval/payment
  {
    files: ["src/server/agent/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/checkout", message: "Agent must not import checkout — recommendation-only" },
            { name: "@/server/checkout/service", message: "Agent must not import CheckoutService — recommendation-only" },
            { name: "@/server/razorpay", message: "Agent must not import razorpay — use catalog only" },
            { name: "@/server/cart", message: "Agent must not import CartService — recommendation-only" },
            { name: "@/server/approval", message: "Agent must not import approval — recommendation-only" },
            { name: "@/server/approval/service", message: "Agent must not import approval — recommendation-only" },
            { name: "@/server/transaction", message: "Agent must not import transaction state machine — recommendation-only" },
            { name: "@/server/transaction/stateMachine", message: "Agent must not import transaction" },
            { name: "@/server/audit", message: "Agent must not import audit" },
            { name: "@/server/webhook", message: "Agent must not import webhook — recommendation-only" },
            { name: "@/app/api/webhooks/razorpay", message: "Agent must not import webhook — recommendation-only" },
            { name: "razorpay", message: "Agent must not import razorpay SDK" },
            { name: "@/lib/prisma", message: "Agent must not import Prisma directly — use CatalogService" },
            { name: "@prisma/client", message: "Agent must not import Prisma directly" },
          ],
          patterns: [
            { group: ["**/checkout/**", "**/razorpay/**", "**/payment*", "**/approval*", "**/cart/**", "**/transaction/**", "**/audit/**", "**/webhook/**", "**/webhooks/**"], message: "Agent is read-only catalog only" },
            { group: ["**/generated/prisma/**"], message: "Agent must not import Prisma generated client" },
            { group: ["**/CheckoutService*"], message: "Agent must not import CheckoutService" },
            { group: ["**/Razorpay*"], message: "Agent must not import Razorpay" },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
