-- CreateTable
CREATE TABLE "CustomerRequest" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "phone" TEXT,
    "product" TEXT NOT NULL,
    "distributor" TEXT,
    "type" TEXT,
    "qtyWanted" INTEGER,
    "qtySetAside" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'New',
    "priority" TEXT,
    "repeatDays" INTEGER,
    "lastDate" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sheetKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "CustomerRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_code_key" ON "CustomerRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRequest_sheetKey_key" ON "CustomerRequest"("sheetKey");

-- CreateIndex
CREATE INDEX "CustomerRequest_store_status_idx" ON "CustomerRequest"("store", "status");
