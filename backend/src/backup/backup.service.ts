import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const BACKUP_VERSION = 1;

/** Ordem direta de FK: pais antes de filhos. O delete usa o reverso. */
export const TABLE_ORDER = [
  'client',
  'user',
  'category',
  'slaPolicy',
  'counter',
  'setting',
  'ticket',
  'ticketComment',
  'ticketEvent',
  'attachment',
  'inboundEmail',
] as const;

export interface BackupFile {
  meta: { version: number; exportedAt: string; appVersion: string };
  data: Record<string, unknown[]>;
}

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  async export(): Promise<BackupFile> {
    const data: Record<string, unknown[]> = {};
    for (const t of TABLE_ORDER) {
      data[t] = await (this.prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[
        t
      ].findMany();
    }
    return {
      meta: {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: process.env.npm_package_version ?? '0.0.0',
      },
      data,
    };
  }

  async import(file: BackupFile): Promise<void> {
    if (!file || typeof file !== 'object' || file.meta?.version !== BACKUP_VERSION) {
      throw new BadRequestException(`Backup incompatível: esperado version ${BACKUP_VERSION}.`);
    }
    if (!file.data || typeof file.data !== 'object') {
      throw new BadRequestException('Backup sem o bloco "data".');
    }
    // ponytail: dataset do MVP cabe em memória e numa transação só. Se um dia
    // passar de ~100k linhas, quebrar em lotes por tabela.
    await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<
        string,
        {
          deleteMany: (a: object) => Promise<unknown>;
          createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<unknown>;
        }
      >;
      for (const name of [...TABLE_ORDER].reverse()) {
        await t[name].deleteMany({});
      }
      for (const name of TABLE_ORDER) {
        const rows = file.data[name] ?? [];
        if (rows.length) await t[name].createMany({ data: rows, skipDuplicates: false });
      }
    });
  }
}
