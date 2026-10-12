import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeText as norm } from '../whatsapp/text.util.js';
import type { ImportPendencia, ImportPreviewRow, ImportResult, ImportRowError } from './dto/import-result.dto.js';

// Só estas colunas precisam existir no cabeçalho; as demais (marca, modelo, numero_serie, ip, mac,
// id_rustdesk, instalado_em, garantia_ate, observacoes) são opcionais.
const REQUIRED = ['cliente', 'local', 'tipo', 'identificacao'];

type Row = Record<string, string | undefined>;

/** Escolhas do usuário para nomes não encontrados: chave → 'criar' | 'ignorar' | 'id:<id>'. */
export type ImportResolucoes = Record<string, string>;

type Opcao = { id: string; name: string };
type Decisao = { id?: string; create?: true; ignored?: true } | null;

/** `YYYY-MM-DD` → Date; qualquer outra coisa → null com flag de erro. */
function parseDate(raw: string): { date: Date | null; bad: boolean } {
  const v = raw?.trim();
  if (!v) return { date: null, bad: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: null, bad: true };
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? { date: null, bad: true } : { date: d, bad: false };
}

/** Primeira aba do .xlsx → linhas {coluna: texto}; cabeçalho normalizado, linhas vazias ignoradas. */
async function readXlsx(buffer: Buffer): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, n) => {
    header[n] = c.text.trim().toLowerCase();
  });
  const out: Row[] = [];
  ws.eachRow((r, rowNum) => {
    if (rowNum === 1) return;
    const row: Row = {};
    header.forEach((h, n) => {
      if (!h) return;
      const c = r.getCell(n);
      // data nativa do Excel vira YYYY-MM-DD (UTC); o resto usa o texto exibido
      row[h] = (c.value instanceof Date ? c.value.toISOString().slice(0, 10) : c.text).trim();
    });
    if (Object.values(row).some((v) => v)) out.push(row);
  });
  return out;
}

/** Ids de `lista` com nome parecido (um contém o outro, ou mesma primeira palavra). */
function similares(nome: string, lista: Opcao[]): string[] {
  const n = norm(nome);
  return lista
    .filter((x) => {
      const m = norm(x.name);
      return m.includes(n) || n.includes(m) || m.split(' ')[0] === n.split(' ')[0];
    })
    .slice(0, 5)
    .map((x) => x.id);
}

@Injectable()
export class AssetsImportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `dryRun`: valida tudo e devolve a pré-visualização por linha, sem gravar nada.
   * Cliente/local/tipo sem correspondência no cadastro viram pendências; `resolucoes` diz o que
   * fazer com cada uma (criar, vincular a um existente ou ignorar as linhas).
   */
  async import(buffer: Buffer, dryRun = false, resolucoes: ImportResolucoes = {}): Promise<ImportResult> {
    let records: Row[];
    try {
      records = await readXlsx(buffer);
    } catch {
      throw new BadRequestException('XLSX inválido: não foi possível ler o arquivo.');
    }
    if (records.length === 0) {
      throw new BadRequestException('Planilha vazia ou sem linhas de dados.');
    }
    const present = Object.keys(records[0]);
    const missing = REQUIRED.filter((c) => !present.includes(c));
    if (missing.length) {
      throw new BadRequestException(`Planilha sem as colunas obrigatórias: ${missing.join(', ')}.`);
    }

    // catálogo em memória (pequeno): comparação sem acento/maiúscula e sem 1 query por linha
    const [clients, types, locations] = await Promise.all([
      this.prisma.client.findMany({ where: { active: true }, select: { id: true, name: true } }),
      this.prisma.assetType.findMany({ where: { active: true }, select: { id: true, name: true } }),
      this.prisma.location.findMany({ select: { id: true, clientId: true, name: true } }),
    ]);
    const clientByName = new Map(clients.map((c) => [norm(c.name), c.id]));
    const typeByName = new Map(types.map((t) => [norm(t.name), t.id]));
    const locByKey = new Map(locations.map((l) => [`${l.clientId}|${norm(l.name)}`, l.id]));

    const decide = (chave: string, existing: string | undefined, valid: (id: string) => boolean): Decisao => {
      if (existing) return { id: existing };
      const r = resolucoes[chave];
      if (r === 'criar') return { create: true };
      if (r === 'ignorar') return { ignored: true };
      if (r?.startsWith('id:') && valid(r.slice(3))) return { id: r.slice(3) };
      return null;
    };

    const pend = new Map<string, ImportPendencia>();
    const addPend = (p: Omit<ImportPendencia, 'linhas'>) => {
      const cur = pend.get(p.chave);
      if (cur) cur.linhas++;
      else pend.set(p.chave, { ...p, linhas: 1 });
    };

    const errors: ImportRowError[] = [];
    const rows: ImportPreviewRow[] = [];
    const seenSerials = new Set<string>();
    const made = new Map<string, string>(); // chave → id criado e já confirmado no banco
    let created = 0;

    for (let i = 0; i < records.length; i++) {
      const line = i + 2; // +1 header, +1 base-1
      const row = records[i];
      try {
        const preview: ImportPreviewRow = {
          line,
          cliente: row.cliente ?? '',
          local: row.local ?? '',
          tipo: row.tipo ?? '',
          identificacao: row.identificacao ?? '',
          numeroSerie: row.numero_serie ?? '',
          remoteId: row.id_rustdesk ?? '',
          error: null,
        };
        rows.push(preview);
        const cliente = (row.cliente ?? '').trim();
        const local = (row.local ?? '').trim();
        const tipo = (row.tipo ?? '').trim();
        const cKey = norm(cliente);
        const lKey = norm(local);
        const tKey = norm(tipo);
        if (!cKey) throw new Error('Cliente obrigatório.');
        if (!lKey) throw new Error('Local obrigatório.');
        if (!tKey) throw new Error('Tipo obrigatório.');

        const tChave = `t:${tKey}`;
        const tDec = decide(tChave, typeByName.get(tKey), (id) => types.some((t) => t.id === id));
        // tipo é independente do cliente: registra a pendência antes de qualquer erro da linha
        if (!tDec) {
          addPend({ chave: tChave, tipo: 'tipo', nome: tipo, sugestoes: similares(tipo, types), opcoes: types });
        }

        const cChave = `c:${cKey}`;
        const cDec = decide(cChave, clientByName.get(cKey), (id) => clients.some((c) => c.id === id));
        if (!cDec) {
          addPend({ chave: cChave, tipo: 'cliente', nome: cliente, sugestoes: similares(cliente, clients), opcoes: clients });
          throw new Error(`Cliente "${cliente}" não encontrado.`);
        }
        if (cDec.ignored) throw new Error('Ignorada: cliente não será importado.');

        const clientLocs = cDec.id ? locations.filter((l) => l.clientId === cDec.id) : [];
        const lChave = `l:${cKey}|${lKey}`;
        const lDec = decide(lChave, cDec.id ? locByKey.get(`${cDec.id}|${lKey}`) : undefined, (id) =>
          clientLocs.some((l) => l.id === id),
        );
        if (!lDec) {
          addPend({
            chave: lChave,
            tipo: 'local',
            nome: local,
            cliente,
            sugestoes: similares(local, clientLocs),
            opcoes: clientLocs,
          });
          throw new Error(`Local "${local}" não encontrado para o cliente.`);
        }
        if (lDec.ignored) throw new Error('Ignorada: local não será importado.');
        if (!tDec) throw new Error(`Tipo "${tipo}" não encontrado.`);
        if (tDec.ignored) throw new Error('Ignorada: tipo não será importado.');

        const label = row.identificacao?.trim();
        if (!label) throw new Error('Identificação obrigatória.');

        const serial = row.numero_serie?.trim() || null;

        const remoteId = row.id_rustdesk?.replace(/\s+/g, '') || null;

        const inst = parseDate(row.instalado_em ?? '');
        const warr = parseDate(row.garantia_ate ?? '');
        if (inst.bad) throw new Error('Data de instalação inválida (use YYYY-MM-DD).');
        if (warr.bad) throw new Error('Data de garantia inválida (use YYYY-MM-DD).');

        if (dryRun) {
          if (serial) {
            const key = `${cDec.id ?? `novo:${cKey}`}|${serial}`;
            const dup =
              seenSerials.has(key) ||
              (cDec.id && (await this.prisma.asset.findFirst({ where: { clientId: cDec.id, serialNumber: serial } })));
            if (dup) throw new Error(`Número de série "${serial}" já cadastrado para o cliente.`);
            seenSerials.add(key);
          }
          created++;
          continue;
        }

        const staged = new Map<string, string>();
        try {
          // ponytail: dedup de numero_serie vem do @@unique([clientId, serialNumber]) do schema, não de um findFirst prévio
          // cliente/local/tipo novos nascem na mesma transação do ativo: se o ativo falhar, nada fica para trás
          await this.prisma.$transaction(async (tx) => {
            const ensure = async (chave: string, id: string | undefined, mk: () => Promise<{ id: string }>) => {
              if (id) return id;
              const hit = made.get(chave) ?? staged.get(chave);
              if (hit) return hit;
              const novo = (await mk()).id;
              staged.set(chave, novo);
              return novo;
            };
            const clientId = await ensure(cChave, cDec.id, () => tx.client.create({ data: { name: cliente } }));
            const locationId = await ensure(lChave, lDec.id, () =>
              tx.location.create({ data: { clientId, name: local } }),
            );
            const typeId = await ensure(tChave, tDec.id, () => tx.assetType.create({ data: { name: tipo } }));
            await tx.asset.create({
              data: {
                clientId,
                locationId,
                typeId,
                label,
                brand: row.marca?.trim() || null,
                model: row.modelo?.trim() || null,
                serialNumber: serial,
                ip: row.ip?.trim() || null,
                mac: row.mac?.trim() || null,
                remoteId,
                installedAt: inst.date,
                warrantyEndsAt: warr.date,
                notes: row.observacoes?.trim() || null,
                status: 'ACTIVE',
              },
            });
          });
          staged.forEach((v, k) => made.set(k, v));
        } catch (e) {
          if ((e as { code?: string }).code === 'P2002') {
            throw new Error(`Número de série "${serial}" já cadastrado para o cliente.`);
          }
          throw e;
        }
        created++;
      } catch (e) {
        errors.push({ line, message: (e as Error).message });
        const r = rows.find((x) => x.line === line);
        if (r) r.error = (e as Error).message;
      }
    }
    return dryRun ? { created, errors, rows, pendencias: [...pend.values()] } : { created, errors };
  }
}
