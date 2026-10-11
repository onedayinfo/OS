import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000;
export const DEFAULT_DAILY_COST_LIMIT_USD = 2;
export const DEFAULT_MONTHLY_COST_LIMIT_USD = 20;
/** Aviso na tela ao chegar em 80% de qualquer teto. */
export const WARN_RATIO = 0.8;
// ponytail: preço fixo (US$ por milhão de tokens, Haiku); se a Anthropic mudar a tabela, ajustar aqui.
const PRICE_IN_PER_MTOK = 1;
const PRICE_OUT_PER_MTOK = 5;

export type PauseReason = 'DAILY_TOKENS' | 'DAILY_COST' | 'MONTHLY_COST';

export interface UsageSnapshot {
  day: { tokens: number; costUsd: number };
  month: { tokens: number; costUsd: number };
  limits: { dailyTokens: number; dailyCostUsd: number; monthlyCostUsd: number };
  paused: boolean;
  reason: PauseReason | null;
  /** true ao passar de 80% de algum teto (e ainda não pausado). */
  warn: boolean;
}

export const costUsd = (input: number, output: number) =>
  (input * PRICE_IN_PER_MTOK + output * PRICE_OUT_PER_MTOK) / 1_000_000;

/** Dia civil no fuso de São Paulo (YYYY-MM-DD). */
function today(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

@Injectable()
export class AiUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async usedToday(): Promise<number> {
    const r = await this.prisma.aiUsage.findUnique({ where: { day: today() } });
    return r ? r.inputTokens + r.outputTokens : 0;
  }

  async limit(): Promise<number> {
    const v = await this.settings.getNumber('ai.dailyTokenLimit');
    return v && v > 0 ? v : DEFAULT_DAILY_TOKEN_LIMIT;
  }

  private async positive(key: string, fallback: number): Promise<number> {
    const v = await this.settings.getNumber(key);
    return v && v > 0 ? v : fallback;
  }

  async snapshot(): Promise<UsageSnapshot> {
    const d = today();
    const [rows, dailyTokens, dailyCostUsd, monthlyCostUsd] = await Promise.all([
      this.prisma.aiUsage.findMany({ where: { day: { startsWith: d.slice(0, 7) } } }),
      this.limit(),
      this.positive('ai.dailyCostLimitUsd', DEFAULT_DAILY_COST_LIMIT_USD),
      this.positive('ai.monthlyCostLimitUsd', DEFAULT_MONTHLY_COST_LIMIT_USD),
    ]);
    const sum = (rs: typeof rows) => ({
      tokens: rs.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0),
      costUsd: rs.reduce((a, r) => a + costUsd(r.inputTokens, r.outputTokens), 0),
    });
    const day = sum(rows.filter((r) => r.day === d));
    const month = sum(rows);
    const checks: [PauseReason, number, number][] = [
      ['DAILY_TOKENS', day.tokens, dailyTokens],
      ['DAILY_COST', day.costUsd, dailyCostUsd],
      ['MONTHLY_COST', month.costUsd, monthlyCostUsd],
    ];
    const hit = checks.find(([, used, max]) => used >= max);
    return {
      day,
      month,
      limits: { dailyTokens, dailyCostUsd, monthlyCostUsd },
      paused: !!hit,
      reason: hit ? hit[0] : null,
      warn: !hit && checks.some(([, used, max]) => used >= max * WARN_RATIO),
    };
  }

  async isPaused(): Promise<boolean> {
    return (await this.snapshot()).paused;
  }

  async add(inputTokens: number, outputTokens: number): Promise<void> {
    const day = today();
    await this.prisma.aiUsage.upsert({
      where: { day },
      create: { day, inputTokens, outputTokens, calls: 1 },
      update: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        calls: { increment: 1 },
      },
    });
  }
}
