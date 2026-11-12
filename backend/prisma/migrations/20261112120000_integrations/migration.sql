-- AlterEnum
ALTER TYPE "TicketOrigin" ADD VALUE 'INTEGRATION';

-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'INTEGRATION_EVENT';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "integrationId" TEXT;

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tokenHash_key" ON "integrations"("tokenHash");

-- CreateIndex
CREATE INDEX "integrations_clientId_idx" ON "integrations"("clientId");

-- CreateIndex
CREATE INDEX "tickets_integrationId_externalId_idx" ON "tickets"("integrationId", "externalId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

