-- Web app: staff logins and per-variant ordering settings.
DROP TABLE IF EXISTS "ProductSetting";

CREATE TYPE "Role" AS ENUM ('OWNER', 'STAFF');

CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "VariantSetting" (
    "variantId" TEXT NOT NULL,
    "cartonSize" INTEGER NOT NULL DEFAULT 5,
    "stamp" "Stamp",
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "VariantSetting_pkey" PRIMARY KEY ("variantId")
);
