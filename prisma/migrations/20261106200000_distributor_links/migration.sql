-- CreateTable
CREATE TABLE "DistributorLink" (
    "vendor" TEXT NOT NULL,
    "distributor" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DistributorLink_pkey" PRIMARY KEY ("vendor")
);
