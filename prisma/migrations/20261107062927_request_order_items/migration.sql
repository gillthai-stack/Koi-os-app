-- CreateTable
CREATE TABLE "RequestOrderItem" (
    "key" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distributor" TEXT NOT NULL,
    "stamp" "Stamp" NOT NULL,
    "cartons" INTEGER NOT NULL,
    "requestIds" INTEGER[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "RequestOrderItem_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "RequestOrderItem_store_idx" ON "RequestOrderItem"("store");
