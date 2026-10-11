import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiClassifierService, AiNotConfiguredError } from './ai-classifier.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { isTrivial } from './text.util.js';

const BATCH = 40; // mensagens pendentes por chamada
const CONTEXT = 6; // mensagens anteriores só para contexto
const MAX_ATTEMPTS = 3;

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly classifier: AiClassifierService,
    private readonly usage: AiUsageService,
  ) {}

  /** Uma rodada: processa os grupos com mensagens PENDING, respeitando o teto diário. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (await this.usage.isPaused()) {
        this.logger.warn('Teto diário de tokens da IA atingido — triagem pausada até amanhã.');
        return;
      }
      const groups = await this.prisma.whatsappGroup.findMany({
        where: { active: true, messages: { some: { aiStatus: 'PENDING' } } },
        include: { client: { select: { name: true } } },
      });
      for (const g of groups) {
        if (await this.usage.isPaused()) break;
        await this.triageGroup(g).catch((err) =>
          this.logger.error(`Falha ao triar o grupo ${g.id}: ${(err as Error).message}`),
        );
      }
    } finally {
      this.running = false;
    }
  }

  private async triageGroup(g: { id: string; clientId: string; client: { name: string } }) {
    const pending = await this.prisma.whatsappMessage.findMany({
      where: { groupId: g.id, aiStatus: 'PENDING' },
      orderBy: { sentAt: 'asc' },
      take: BATCH,
    });
    const useful = pending.filter((m) => m.body && !isTrivial(m.body));
    const trivialIds = pending.filter((m) => !useful.includes(m)).map((m) => m.id);
    if (trivialIds.length) {
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: trivialIds } }, data: { aiStatus: 'SKIPPED' } });
    }
    if (!useful.length) return;

    const before = await this.prisma.whatsappMessage.findMany({
      where: { groupId: g.id, sentAt: { lt: useful[0].sentAt }, body: { not: null } },
      orderBy: { sentAt: 'desc' },
      take: CONTEXT,
    });
    const line = (m: { senderName: string | null; senderPhone: string; body: string | null }) => ({
      sender: m.senderName ?? (m.senderPhone || 'alguém'),
      text: m.body ?? '',
    });

    let out;
    try {
      out = await this.classifier.classify({
        clientName: g.client.name,
        context: before.reverse().map(line),
        pending: useful.map(line),
      });
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        this.logger.warn(err.message);
        return; // segue PENDING, sem gastar tentativas
      }
      this.logger.error(`IA falhou no grupo ${g.id}: ${(err as Error).message}`);
      const ids = useful.map((m) => m.id);
      await this.prisma.whatsappMessage.updateMany({ where: { id: { in: ids } }, data: { aiAttempts: { increment: 1 } } });
      await this.prisma.whatsappMessage.updateMany({
        where: { groupId: g.id, aiStatus: 'PENDING', aiAttempts: { gte: MAX_ATTEMPTS } },
        data: { aiStatus: 'FAILED' },
      });
      return;
    }

    await this.usage.add(out.inputTokens, out.outputTokens);
    await this.prisma.$transaction(async (tx) => {
      for (const item of out.items) {
        const msgs = item.messageIndexes.map((i) => useful[i]);
        for (const msg of msgs) {
          await tx.whatsappMessage.update({
            where: { id: msg.id },
            data: { sentiment: item.sentiment, aiResult: item as unknown as Prisma.InputJsonValue },
          });
        }
        if (item.isRequest) {
          await tx.ticketSuggestion.create({
            data: {
              groupId: g.id,
              clientId: g.clientId,
              messageIds: msgs.map((x) => x.id),
              excerpt: msgs.map((x) => `${x.senderName ?? x.senderPhone}: ${x.body}`).join('\n').slice(0, 1000),
              urgency: item.urgency,
              sentiment: item.sentiment,
              summary: item.summary,
            },
          });
        }
      }
      // ponytail: toda mensagem útil enviada vira ANALYZED (a IA viu, com ou sem assunto).
      await tx.whatsappMessage.updateMany({
        where: { id: { in: useful.map((m) => m.id) } },
        data: { aiStatus: 'ANALYZED' },
      });
    });
  }
}
