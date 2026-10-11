import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ImportPreviewRow, ImportResult, ImportRowError } from './dto/import-result.dto.js';

// Só estas colunas precisam existir no cabeçalho; as demais (marca, modelo, numero_serie, ip, mac,
// id_rustdesk, instalado_em, garantia_ate, observacoes) são opcionais.
const REQUIRED = ['cliente', 'local', 'tipo', 'identificacao'];

type Row = Record<string, string | undefined>;

/** `YYYY-MM-DD` → Date; qualquer outra coisa → null com flag de erro. */
function parseDate(raw: string): { date: Date | null; bad: boolean } {
  const v = raw?.trim();
  if (!v) return { date: null, bad: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: null, bad: true };
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? { date: null, bad: true } : { date: d, bad: false };
}

@Injectable()
export class AssetsImportService {
  constructor(private readonly prisma: PrismaService) {}

  /** `dryRun`: valida tudo e devolve a pré-visualização por linha, sem gravar nada. */
  async import(buffer: Buffer, dryRun = false): Promise<ImportResult> {
    let records: Row[];
    try {
      records = parse(buffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('CSV inválido: não foi possível ler o arquivo.');
    }
    if (records.length === 0) {
      throw new BadRequestException('CSV vazio ou sem linhas de dados.');
    }
    const present = Object.keys(records[0]);
    const missing = REQUIRED.filter((c) => !present.includes(c));
    if (missing.length) {
      throw new BadRequestException(`CSV sem as colunas obrigatórias: ${missing.join(', ')}.`);
    }

    const errors: ImportRowError[] = [];
    const rows: ImportPreviewRow[] = [];
    const seenSerials = new Set<string>();
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
        const client = await this.prisma.client.findFirst({
          where: { name: row.cliente?.trim(), active: true },
        });
        if (!client) throw new Error(`Cliente "${row.cliente}" não encontrado.`);

        const location = await this.prisma.location.findFirst({
          where: { clientId: client.id, name: row.local?.trim() },
        });
        if (!location) throw new Error(`Local "${row.local}" não encontrado para o cliente.`);

        const type = await this.prisma.assetType.findFirst({
          where: { name: row.tipo?.trim(), active: true },
        });
        if (!type) throw new Error(`Tipo "${row.tipo}" não encontrado.`);

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
            const key = `${client.id}|${serial}`;
            const dup = seenSerials.has(key)
              || (await this.prisma.asset.findFirst({ where: { clientId: client.id, serialNumber: serial } }));
            if (dup) throw new Error(`Número de série "${serial}" já cadastrado para o cliente.`);
            seenSerials.add(key);
          }
          created++;
          continue;
        }

        try {
          // ponytail: dedup de numero_serie vem do @@unique([clientId, serialNumber]) do schema, não de um findFirst prévio
          await this.prisma.$transaction((tx) =>
            tx.asset.create({
              data: {
                clientId: client.id,
                locationId: location.id,
                typeId: type.id,
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
            }),
          );
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
    return dryRun ? { created, errors, rows } : { created, errors };
  }
}
