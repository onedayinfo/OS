-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('GENERIC', 'PHOTO_BEFORE', 'PHOTO_AFTER', 'SIGNATURE', 'REPORT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TicketEventType" ADD VALUE 'VISIT_SCHEDULED';
ALTER TYPE "TicketEventType" ADD VALUE 'VISIT_STARTED';
ALTER TYPE "TicketEventType" ADD VALUE 'VISIT_COMPLETED';
ALTER TYPE "TicketEventType" ADD VALUE 'VISIT_CANCELLED';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "kind" "AttachmentKind" NOT NULL DEFAULT 'GENERIC',
ADD COLUMN     "visitId" TEXT;

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "checklistTemplateId" TEXT,
    "status" "VisitStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledStart" TIMESTAMP(3) NOT NULL,
    "scheduledEnd" TIMESTAMP(3) NOT NULL,
    "checkInAt" TIMESTAMP(3),
    "checkInLat" DOUBLE PRECISION,
    "checkInLng" DOUBLE PRECISION,
    "checkOutAt" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "laborStartAt" TIMESTAMP(3),
    "laborEndAt" TIMESTAMP(3),
    "notes" TEXT,
    "reportSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_checklist_answers" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "visit_checklist_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_categoryId_key" ON "checklist_templates"("categoryId");

-- CreateIndex
CREATE INDEX "checklist_template_items_templateId_idx" ON "checklist_template_items"("templateId");

-- CreateIndex
CREATE INDEX "visits_ticketId_idx" ON "visits"("ticketId");

-- CreateIndex
CREATE INDEX "visits_technicianId_idx" ON "visits"("technicianId");

-- CreateIndex
CREATE UNIQUE INDEX "visit_checklist_answers_visitId_itemId_key" ON "visit_checklist_answers"("visitId", "itemId");

-- CreateIndex
CREATE INDEX "attachments_visitId_idx" ON "attachments"("visitId");

-- AddForeignKey
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_checklist_answers" ADD CONSTRAINT "visit_checklist_answers_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_checklist_answers" ADD CONSTRAINT "visit_checklist_answers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "checklist_template_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
