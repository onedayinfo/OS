import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const BACKUP_VERSION = 2;

/** Tabelas do formato v1 (até a 0.12.3); restaurar um v1 só toca nestas. */
export const TABLE_ORDER_V1 = [
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

/**
 * Ordem direta de FK: pais antes de filhos. O delete usa o reverso.
 * Fora de propósito: `refreshToken` (sessões; todos entram de novo após restaurar).
 * O teste de integração falha se um modelo novo do Prisma não entrar aqui.
 */
export const TABLE_ORDER = [
  'client',
  'user',
  'category',
  'slaPolicy',
  'counter',
  'setting',
  'aiUsage',
  'quoteCounter',
  'checklistTemplate',
  'checklistTemplateItem',
  'categorySlaPolicy',
  'assetType',
  'location',
  'asset',
  'contract',
  'contractSlaPolicy',
  'catalogItem',
  'warehouse',
  'stockBalance',
  'stockEntry',
  'stockTransfer',
  'quote',
  'quoteItem',
  'opportunity',
  'opportunityNote',
  'knowledgeArticle',
  'ticket',
  'ticketSatisfactionSurvey',
  'ticketComment',
  'ticketEvent',
  'visit',
  'visitChecklistAnswer',
  'ticketMaterialUsage',
  'attachment',
  'inboundEmail',
  'whatsappGroup',
  'whatsappMessage',
  'triggerPhrase',
  'ticketSuggestion',
] as const;

/**
 * FKs em ciclo (Quote.ticketId <-> Ticket.quoteId): entram nulas na 1ª passada e
 * são preenchidas depois que todas as tabelas existem.
 */
export const DEFERRED_FK: Readonly<Record<string, string>> = { quote: 'ticketId' };

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
    if (!file || typeof file !== 'object' || ![1, BACKUP_VERSION].includes(file.meta?.version)) {
      throw new BadRequestException(`Backup incompatível: esperado version 1 ou ${BACKUP_VERSION}.`);
    }
    if (!file.data || typeof file.data !== 'object') {
      throw new BadRequestException('Backup sem o bloco "data".');
    }
    // ponytail: dataset do MVP cabe em memória e numa transação só. Se um dia
    // passar de ~100k linhas, quebrar em lotes por tabela.
    const tables: readonly string[] = file.meta.version === 1 ? TABLE_ORDER_V1 : TABLE_ORDER;
    await this.prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<
        string,
        {
          deleteMany: (a: object) => Promise<unknown>;
          createMany: (a: { data: unknown[]; skipDuplicates: boolean }) => Promise<unknown>;
          update: (a: { where: { id: unknown }; data: object }) => Promise<unknown>;
        }
      >;
      for (const name of [...tables].reverse()) {
        await t[name].deleteMany({});
      }
      for (const name of tables) {
        const rows = file.data[name] ?? [];
        const fk = DEFERRED_FK[name];
        const first = fk ? (rows as Record<string, unknown>[]).map((r) => ({ ...r, [fk]: null })) : rows;
        if (rows.length) await t[name].createMany({ data: first, skipDuplicates: false });
      }
      for (const [name, fk] of Object.entries(DEFERRED_FK)) {
        if (!tables.includes(name)) continue;
        for (const r of (file.data[name] ?? []) as Record<string, unknown>[]) {
          if (r[fk] != null) await t[name].update({ where: { id: r.id }, data: { [fk]: r[fk] } });
        }
      }
    });
  }
}
