import type { PrismaService } from '../prisma/prisma.service.js';

const empty = (v: string | null | undefined) => v == null || v.trim() === '';

// Só campos técnicos. Nunca label/description/assignedTo/notes/locationId/status (curados pelo usuário).
export async function syncAsset(prisma: PrismaService, deviceId: string): Promise<void> {
  const d = await prisma.agentDevice.findUnique({ where: { id: deviceId }, include: { asset: true } });
  const a = d?.asset;
  if (!d || !a) return;
  const data: Record<string, unknown> = { lastSeenAt: d.lastSeenAt };
  if (d.ip) data.ip = d.ip;
  if (d.mac) data.mac = d.mac;
  if (d.specs != null) data.specs = d.specs;
  if (empty(a.brand) && d.manufacturer) data.brand = d.manufacturer;
  if (empty(a.model) && d.model) data.model = d.model;
  if (empty(a.serialNumber) && d.serialNumber) data.serialNumber = d.serialNumber;
  try {
    await prisma.asset.update({ where: { id: a.id }, data });
  } catch (e: any) {
    if (e?.code !== 'P2002' || !('serialNumber' in data)) throw e;
    // serial já usado por outro ativo do cliente: repete sem ele
    delete data.serialNumber;
    await prisma.asset.update({ where: { id: a.id }, data });
  }
}
