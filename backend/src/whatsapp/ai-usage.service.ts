import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000;

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

  async isPaused(): Promise<boolean> {
    return (await this.usedToday()) >= (await this.limit());
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
