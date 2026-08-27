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
  // Phase 3-4 security wall: agent must not import checkout/razorpay/prisma/cart
  {
    files: ["src/server/agent/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/server/checkout", message: "Agent must not import checkout — recommendation-only" },
            { name: "@/server/razorpay", message: "Agent must not import razorpay — use catalog only" },
            { name: "@/server/cart", message: "Agent must not import CartService — recommendation-only" },
            { name: "razorpay", message: "Agent must not import razorpay SDK" },
            { name: "@/lib/prisma", message: "Agent must not import Prisma directly — use CatalogService" },
            { name: "@prisma/client", message: "Agent must not import Prisma directly" },
          ],
          patterns: [
            { group: ["**/checkout/**", "**/razorpay/**", "**/payment*", "**/approval*", "**/cart/**"], message: "Agent is read-only catalog only" },
            { group: ["**/generated/prisma/**"], message: "Agent must not import Prisma generated client" },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
