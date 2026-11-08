-- CreateEnum
CREATE TYPE "AgentDeviceStatus" AS ENUM ('PENDING', 'LINKED', 'IGNORED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "assignedTo" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "specs" JSONB;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "agentEnrollCode" TEXT;

-- CreateTable
CREATE TABLE "agent_devices" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "machineGuid" TEXT NOT NULL,
    "serialKey" TEXT NOT NULL DEFAULT '',
    "hostname" TEXT NOT NULL,
    "serialNumber" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "ip" TEXT,
    "mac" TEXT,
    "status" "AgentDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "cloneSuspect" BOOLEAN NOT NULL DEFAULT false,
    "assetId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "agentVersion" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "specs" JSONB,
    "software" JSONB,
    "inventoryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_devices_assetId_key" ON "agent_devices"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_devices_tokenHash_key" ON "agent_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_devices_clientId_status_idx" ON "agent_devices"("clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_devices_clientId_machineGuid_serialKey_key" ON "agent_devices"("clientId", "machineGuid", "serialKey");

-- CreateIndex
CREATE UNIQUE INDEX "clients_agentEnrollCode_key" ON "clients"("agentEnrollCode");

-- AddForeignKey
ALTER TABLE "agent_devices" ADD CONSTRAINT "agent_devices_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_devices" ADD CONSTRAINT "agent_devices_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

