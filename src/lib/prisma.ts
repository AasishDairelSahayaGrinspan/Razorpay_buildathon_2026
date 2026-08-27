import path from "path";
import { PrismaClient } from "@/generated/prisma/client";

// Turbopack dev server resolves file:./dev.db relative to .next, not project root.
// Force absolute path for runtime so both CLI (file:./dev.db -> prisma/dev.db) and Next dev work.
// Keep .env as file:./dev.db for CLI migration (creates prisma/dev.db), runtime uses prisma/dev.db absolute.
const absoluteDbPath = path.join(process.cwd(), "prisma", "dev.db");
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("file:/")) {
  // If relative, override to absolute prisma/dev.db for Next runtime
  // CLI will still use original .env value when running migrate (process.cwd is project root at that time as well,
  // but we have both dev.db and prisma/dev.db copies — absolute ensures dev server always finds it)
  process.env.DATABASE_URL = `file:${absoluteDbPath}`;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
