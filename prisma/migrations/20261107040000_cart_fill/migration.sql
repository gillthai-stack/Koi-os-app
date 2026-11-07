-- CreateEnum
CREATE TYPE "QtyUnit" AS ENUM ('CARTON', 'PIECE');

-- CreateTable
CREATE TABLE "DistroProduct" (
    "variantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DistroProduct_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "DistributorSetting" (
    "distributor" TEXT NOT NULL,
    "qtyUnit" "QtyUnit" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "DistributorSetting_pkey" PRIMARY KEY ("distributor")
);
