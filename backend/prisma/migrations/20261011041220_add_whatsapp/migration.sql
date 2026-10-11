-- CreateEnum
CREATE TYPE "WhatsappMessageType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "WhatsappAiStatus" AS ENUM ('PENDING', 'ANALYZED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DISCARDED');

-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'WHATSAPP_IN';

-- AlterEnum
ALTER TYPE "TicketOrigin" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_groups" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "clientId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderPhone" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT,
    "senderUserId" TEXT,
    "type" "WhatsappMessageType" NOT NULL,
    "body" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "aiStatus" "WhatsappAiStatus" NOT NULL DEFAULT 'PENDING',
    "aiAttempts" INTEGER NOT NULL DEFAULT 0,
    "aiResult" JSONB,
    "sentiment" DOUBLE PRECISION,
    "ticketId" TEXT,
    "triggerPhraseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trigger_phrases" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "phrase" TEXT NOT NULL,
    "phraseNorm" TEXT NOT NULL,
    "categoryId" TEXT,
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trigger_phrases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_suggestions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "messageIds" TEXT[],
    "excerpt" TEXT NOT NULL,
    "urgency" INTEGER NOT NULL,
    "sentiment" DOUBLE PRECISION,
    "summary" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "ticketId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "day" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_externalId_key" ON "whatsapp_groups"("externalId");

-- CreateIndex
CREATE INDEX "whatsapp_groups_clientId_idx" ON "whatsapp_groups"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_externalId_key" ON "whatsapp_messages"("externalId");

-- CreateIndex
CREATE INDEX "whatsapp_messages_groupId_sentAt_idx" ON "whatsapp_messages"("groupId", "sentAt");

-- CreateIndex
CREATE INDEX "whatsapp_messages_aiStatus_idx" ON "whatsapp_messages"("aiStatus");

-- CreateIndex
CREATE INDEX "whatsapp_messages_ticketId_idx" ON "whatsapp_messages"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "trigger_phrases_clientId_phraseNorm_key" ON "trigger_phrases"("clientId", "phraseNorm");

-- CreateIndex
CREATE INDEX "ticket_suggestions_status_createdAt_idx" ON "ticket_suggestions"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_phrases" ADD CONSTRAINT "trigger_phrases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trigger_phrases" ADD CONSTRAINT "trigger_phrases_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_suggestions" ADD CONSTRAINT "ticket_suggestions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_suggestions" ADD CONSTRAINT "ticket_suggestions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_suggestions" ADD CONSTRAINT "ticket_suggestions_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
