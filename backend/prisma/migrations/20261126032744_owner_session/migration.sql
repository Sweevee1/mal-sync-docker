-- AlterTable
ALTER TABLE "AppSetting" ADD COLUMN "adminHashFingerprint" TEXT;

-- AlterTable
ALTER TABLE "ServiceCredential" ADD COLUMN "oauthStateExpiresAt" DATETIME;

-- CreateTable
CREATE TABLE "Session" (
    "idHash" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);
