-- AlterTable
ALTER TABLE "ServiceCredential" ADD COLUMN "clientId" TEXT;
ALTER TABLE "ServiceCredential" ADD COLUMN "clientSecretEnc" TEXT;
ALTER TABLE "ServiceCredential" ADD COLUMN "redirectUri" TEXT;
