import { BadRequestException } from '@nestjs/common';
import { AssetsImportService } from './assets-import.service.js';

const HEADER = 'cliente,local,tipo,identificacao,marca,modelo,numero_serie,ip,mac,instalado_em,garantia_ate,observacoes';

const makePrisma = () => ({
  client: { findFirst: vi.fn() },
  location: { findFirst: vi.fn() },
  assetType: { findFirst: vi.fn() },
  asset: { create: vi.fn().mockResolvedValue({ id: 'a1' }) },
  $transaction: vi.fn((fn: any) => fn(makeTx())),
});
const makeTx = () => ({ asset: { create: vi.fn().mockResolvedValue({ id: 'a1' }) } });

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('AssetsImportService', () => {
  it('cabeçalho ausente -> BadRequest do arquivo todo', async () => {
    const s = new AssetsImportService(makePrisma() as any);
    await expect(s.import(buf('foo,bar\n1,2'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('linha com cliente inexistente vira erro, não cria', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue(null);
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,,,,,,,,`));
    expect(out.created).toBe(0);
    expect(out.errors[0]).toEqual({ line: 2, message: expect.stringContaining('Cliente') });
  });

  it('linha boa cria o ativo (status ACTIVE)', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.location.findFirst.mockResolvedValue({ id: 'l1', clientId: 'c1' });
    prisma.assetType.findFirst.mockResolvedValue({ id: 't1' });
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,Intelbras,VIP,SN123,10.0.0.5,,2024-01-10,2026-01-10,porta`));
    expect(out).toEqual({ created: 1, errors: [] });
  });

  it('data inválida vira erro na linha', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.location.findFirst.mockResolvedValue({ id: 'l1', clientId: 'c1' });
    prisma.assetType.findFirst.mockResolvedValue({ id: 't1' });
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,,,,,,10/01/2024,,`));
    expect(out.created).toBe(0);
    expect(out.errors[0].message).toContain('Data');
  });
});
