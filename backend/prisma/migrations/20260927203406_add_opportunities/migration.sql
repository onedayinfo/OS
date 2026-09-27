-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('NEW', 'CONTACTED', 'PROPOSAL', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "opportunities" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'NEW',
    "value" DOUBLE PRECISION,
    "clientId" TEXT,
    "leadName" TEXT,
    "leadCompany" TEXT,
    "leadPhone" TEXT,
    "leadEmail" TEXT,
    "ownerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "lostReason" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "nextFollowUpNote" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_notes" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opportunity_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_quoteId_key" ON "opportunities"("quoteId");

-- CreateIndex
CREATE INDEX "opportunities_clientId_idx" ON "opportunities"("clientId");

-- CreateIndex
CREATE INDEX "opportunities_ownerId_idx" ON "opportunities"("ownerId");

-- CreateIndex
CREATE INDEX "opportunities_stage_idx" ON "opportunities"("stage");

-- CreateIndex
CREATE INDEX "opportunity_notes_opportunityId_idx" ON "opportunity_notes"("opportunityId");

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_notes" ADD CONSTRAINT "opportunity_notes_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_notes" ADD CONSTRAINT "opportunity_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
