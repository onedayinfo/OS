-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FranchiseUnit" AS ENUM ('VISITS', 'HOURS');

-- AlterEnum
ALTER TYPE "TicketOrigin" ADD VALUE 'CONTRACT';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "contractId" TEXT;

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "monthlyValue" DOUBLE PRECISION,
    "franchiseUnit" "FranchiseUnit" NOT NULL,
    "franchiseAmount" INTEGER NOT NULL,
    "preventiveFrequencyMonths" INTEGER,
    "nextGenerationAt" TIMESTAMP(3),
    "defaultCategoryId" TEXT,
    "renewalWarnedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_sla_policies" (
    "contractId" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL,
    "hours" INTEGER NOT NULL,

    CONSTRAINT "contract_sla_policies_pkey" PRIMARY KEY ("contractId","priority")
);

-- CreateTable
CREATE TABLE "_ContractToLocation" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ContractToLocation_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_AssetToContract" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AssetToContract_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "contracts_clientId_idx" ON "contracts"("clientId");

-- CreateIndex
CREATE INDEX "_ContractToLocation_B_index" ON "_ContractToLocation"("B");

-- CreateIndex
CREATE INDEX "_AssetToContract_B_index" ON "_AssetToContract"("B");

-- CreateIndex
CREATE INDEX "tickets_contractId_idx" ON "tickets"("contractId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_sla_policies" ADD CONSTRAINT "contract_sla_policies_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContractToLocation" ADD CONSTRAINT "_ContractToLocation_A_fkey" FOREIGN KEY ("A") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContractToLocation" ADD CONSTRAINT "_ContractToLocation_B_fkey" FOREIGN KEY ("B") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetToContract" ADD CONSTRAINT "_AssetToContract_A_fkey" FOREIGN KEY ("A") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AssetToContract" ADD CONSTRAINT "_AssetToContract_B_fkey" FOREIGN KEY ("B") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
