-- CreateTable
CREATE TABLE "DistroOrder" (
    "id" SERIAL NOT NULL,
    "distributor" TEXT NOT NULL,
    "store" TEXT,
    "refs" TEXT[],
    "amount" DOUBLE PRECISION,
    "stage" INTEGER NOT NULL DEFAULT 1,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "tracking" TEXT[],
    "note" TEXT,
    "emailUrl" TEXT,
    "source" TEXT NOT NULL DEFAULT 'gmail',
    "paidAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DistroOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderMail" (
    "id" TEXT NOT NULL,
    "kind" TEXT,
    "summary" TEXT,
    "orderId" INTEGER,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderMail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DistroOrder_stage_idx" ON "DistroOrder"("stage");

-- CreateIndex
CREATE INDEX "OrderMail_receivedAt_idx" ON "OrderMail"("receivedAt");

-- AddForeignKey
ALTER TABLE "OrderMail" ADD CONSTRAINT "OrderMail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "DistroOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

