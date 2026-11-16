-- AlterTable
ALTER TABLE "integrations" ADD COLUMN     "lastPayload" JSONB,
ADD COLUMN     "lastPayloadAt" TIMESTAMP(3),
ADD COLUMN     "mapping" JSONB;
