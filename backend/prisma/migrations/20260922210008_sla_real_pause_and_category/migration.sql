-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "slaPausedAt" TIMESTAMP(3),
ADD COLUMN     "slaPausedMs" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "category_sla_policies" (
    "categoryId" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "hours" INTEGER NOT NULL,

    CONSTRAINT "category_sla_policies_pkey" PRIMARY KEY ("categoryId","priority")
);

-- AddForeignKey
ALTER TABLE "category_sla_policies" ADD CONSTRAINT "category_sla_policies_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
