import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AssetsImportService } from './assets-import.service.js';

// Prisma falso em memória (sem Postgres): catálogo com 1 cliente, 1 local e 1 tipo.
const HEAD = ['cliente', 'local', 'tipo', 'identificacao'];

async function xlsx(rows: string[][], head: string[] = HEAD) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ativos');
  ws.addRow(head);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function fakePrisma() {
  const db = {
    clients: [{ id: 'c1', name: 'Acme Ltda' }] as { id: string; name: string }[],
    types: [{ id: 't1', name: 'Câmera' }] as { id: string; name: string }[],
    locations: [{ id: 'l1', clientId: 'c1', name: 'Matriz' }] as { id: string; clientId: string; name: string }[],
    assets: [] as Record<string, unknown>[],
  };
  let n = 0;
  const mk = (list: Record<string, unknown>[]) => async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `n${++n}`, ...data };
    list.push(row);
    return row as { id: string };
  };
  const tx = {
    client: { create: mk(db.clients) },
    location: { create: mk(db.locations) },
    assetType: { create: mk(db.types) },
    asset: { create: mk(db.assets) },
  };
  const prisma = {
    client: { findMany: async () => db.clients },
    assetType: { findMany: async () => db.types },
    location: { findMany: async () => db.locations },
    asset: { findFirst: async () => null },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { db, prisma, svc: new AssetsImportService(prisma as never) };
}

describe('AssetsImportService', () => {
  it('cabeçalho ausente -> BadRequest do arquivo todo', async () => {
    const { svc } = fakePrisma();
    await expect(svc.import(await xlsx([['1', '2']], ['foo', 'bar']))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('arquivo que não é xlsx -> BadRequest', async () => {
    const { svc } = fakePrisma();
    await expect(svc.import(Buffer.from('a,b\n1,2'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('linha boa cria o ativo (status ACTIVE); só as 4 colunas bastam e id_rustdesk perde espaços', async () => {
    const { svc, db } = fakePrisma();
    const buf = await xlsx([['Acme Ltda', 'Matriz', 'Câmera', 'CAM-01', '123 456 789']], [...HEAD, 'id_rustdesk']);
    const out = await svc.import(buf);
    expect(out).toEqual({ created: 1, errors: [] });
    expect(db.assets[0]).toMatchObject({ clientId: 'c1', status: 'ACTIVE', remoteId: '123456789' });
  });

  it('data inválida vira erro na linha', async () => {
    const { svc } = fakePrisma();
    const buf = await xlsx([['Acme Ltda', 'Matriz', 'Câmera', 'CAM-01', '10/01/2024']], [...HEAD, 'instalado_em']);
    const out = await svc.import(buf);
    expect(out.created).toBe(0);
    expect(out.errors[0].message).toContain('Data');
  });

  it('dryRun valida e devolve as linhas sem gravar', async () => {
    const { svc, prisma } = fakePrisma();
    const out = await svc.import(
      await xlsx([['Acme Ltda', 'Matriz', 'Câmera', 'CAM-01'], ['Acme Ltda', 'Matriz', 'Câmera', '']]),
      true,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(out.created).toBe(1);
    expect(out.rows).toHaveLength(2);
    expect(out.rows![1].error).toContain('Identificação');
  });
});

describe('AssetsImportService — pendências', () => {
  it('compara sem acento/maiúscula e lista cliente/local/tipo novos como pendência', async () => {
    const { svc } = fakePrisma();
    const buf = await xlsx([
      ['ACME ltda', 'matriz', 'camera', 'A1'], // tudo existe (normalizado)
      ['Acme', 'Filial', 'Câmera', 'A2'], // cliente novo (sugere Acme Ltda)
      ['Acme', 'Filial', 'Câmera', 'A3'], // mesma pendência -> 2 linhas
      ['ACME ltda', 'Depósito', 'Switch', 'A4'], // local e tipo novos
    ]);
    const r = await svc.import(buf, true);
    expect(r.created).toBe(1);
    const p = Object.fromEntries(r.pendencias!.map((x) => [x.chave, x]));
    expect(p['c:acme'].linhas).toBe(2);
    expect(p['c:acme'].sugestoes).toEqual(['c1']);
    expect(p['l:acme ltda|deposito'].tipo).toBe('local');
    expect(p['t:switch'].tipo).toBe('tipo');
  });

  it('criar/vincular/ignorar: grava só o decidido, sem duplicar', async () => {
    const { svc, db } = fakePrisma();
    const buf = await xlsx([
      ['Novo Cliente', 'Sede', 'Câmera', 'B1'],
      ['Novo Cliente', 'Sede', 'Câmera', 'B2'], // reaproveita cliente e local criados
      ['Acme', 'Matriz', 'Câmera', 'B3'], // vincula a Acme Ltda
      ['Outro', 'X', 'Câmera', 'B4'], // ignorada
    ]);
    const r = await svc.import(buf, false, {
      'c:novo cliente': 'criar',
      'l:novo cliente|sede': 'criar',
      'c:acme': 'id:c1',
      'c:outro': 'ignorar',
    });
    expect(r.created).toBe(3);
    expect(r.errors.map((e) => e.line)).toEqual([5]);
    expect(db.clients.filter((c) => c.name === 'Novo Cliente')).toHaveLength(1);
    expect(db.locations.filter((l) => l.name === 'Sede')).toHaveLength(1);
    expect(db.assets.filter((a) => a.clientId === 'c1')).toHaveLength(1);
  });

  it('dryRun não grava nada mesmo com "criar"', async () => {
    const { svc, db } = fakePrisma();
    const r = await svc.import(await xlsx([['Novo', 'Sede', 'Câmera', 'C1']]), true, {
      'c:novo': 'criar',
      'l:novo|sede': 'criar',
    });
    expect(r.created).toBe(1);
    expect(db.clients).toHaveLength(1);
    expect(db.assets).toHaveLength(0);
  });
});
