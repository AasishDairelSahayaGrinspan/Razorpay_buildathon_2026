-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cartId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL DEFAULT 'merchant_demo',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "cartHash" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "transactionId" TEXT,
    "cartId" TEXT,
    "requestId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromState" TEXT,
    "toState" TEXT,
    "cartHash" TEXT,
    "policyPassed" INTEGER,
    "policyTotal" INTEGER,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "verificationSource" TEXT,
    CONSTRAINT "AuditEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditEvent_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Transaction_cartId_idx" ON "Transaction"("cartId");

-- CreateIndex
CREATE INDEX "Transaction_merchantId_idx" ON "Transaction"("merchantId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_cartId_cartHash_key" ON "Transaction"("cartId", "cartHash");

-- CreateIndex
CREATE INDEX "AuditEvent_transactionId_idx" ON "AuditEvent"("transactionId");

-- CreateIndex
CREATE INDEX "AuditEvent_cartId_idx" ON "AuditEvent"("cartId");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_idx" ON "AuditEvent"("eventType");
