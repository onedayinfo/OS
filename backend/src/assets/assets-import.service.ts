import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ImportResult, ImportRowError } from './dto/import-result.dto.js';

const COLUMNS = [
  'cliente', 'local', 'tipo', 'identificacao', 'marca', 'modelo',
  'numero_serie', 'ip', 'mac', 'instalado_em', 'garantia_ate', 'observacoes',
];

type Row = Record<(typeof COLUMNS)[number], string>;

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

  async import(buffer: Buffer): Promise<ImportResult> {
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
    const missing = COLUMNS.filter((c) => !present.includes(c));
    if (missing.length) {
      throw new BadRequestException(`CSV sem as colunas obrigatórias: ${missing.join(', ')}.`);
    }

    const errors: ImportRowError[] = [];
    let created = 0;

    for (let i = 0; i < records.length; i++) {
      const line = i + 2; // +1 header, +1 base-1
      const row = records[i];
      try {
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

        if (!row.identificacao?.trim()) throw new Error('Identificação obrigatória.');

        const serial = row.numero_serie?.trim() || null;

        const inst = parseDate(row.instalado_em);
        const warr = parseDate(row.garantia_ate);
        if (inst.bad) throw new Error('Data de instalação inválida (use YYYY-MM-DD).');
        if (warr.bad) throw new Error('Data de garantia inválida (use YYYY-MM-DD).');

        try {
          // ponytail: dedup de numero_serie vem do @@unique([clientId, serialNumber]) do schema, não de um findFirst prévio
          await this.prisma.$transaction((tx) =>
            tx.asset.create({
              data: {
                clientId: client.id,
                locationId: location.id,
                typeId: type.id,
                label: row.identificacao.trim(),
                brand: row.marca?.trim() || null,
                model: row.modelo?.trim() || null,
                serialNumber: serial,
                ip: row.ip?.trim() || null,
                mac: row.mac?.trim() || null,
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
      }
    }
    return { created, errors };
  }
}
