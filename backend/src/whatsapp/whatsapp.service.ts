import { Injectable, Logger } from '@nestjs/common';
import type { TriggerPhrase, WhatsappGroup } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { phoneKey } from '../common/phone.util.js';
import { isUniqueViolation } from './db-errors.js';
import { matchStart } from './text.util.js';
import type { ParsedWhatsappMessage } from './evolution-payload.js';

// ponytail: janela fixa de 24h; mensagens mais velhas (reentrega offline) só são gravadas.
const MAX_TRIGGER_AGE_MS = 24 * 3600_000;
const TERMINAL = ['RESOLVED', 'CLOSED', 'CANCELLED'] as const;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
  ) {}

  /**
   * Caminho de uma mensagem de grupo (spec §4). O cliente vem do grupo CADASTRADO; o
   * telefone só identifica o contato. Idempotente por `externalId`.
   */
  async ingest(m: ParsedWhatsappMessage): Promise<{ stored: boolean; ticketId: string | null }> {
    const group = await this.prisma.whatsappGroup.findUnique({ where: { externalId: m.groupJid } });
    if (!group || !group.active) return { stored: false, ticketId: null };

    const senderUserId = await this.findSender(group.clientId, m.senderPhone);
    const body = m.type === 'TEXT' ? m.body : null;
    const tooOld = Date.now() - m.sentAt.getTime() > MAX_TRIGGER_AGE_MS;
    const hit = body && !tooOld ? await this.matchTrigger(group.clientId, body) : null;

    let rowId: string;
    try {
      const row = await this.prisma.whatsappMessage.create({
        data: {
          externalId: m.externalId,
          groupId: group.id,
          senderPhone: m.senderPhone,
          senderName: m.senderName,
          senderUserId,
          type: m.type,
          body: m.body,
          sentAt: m.sentAt,
          // Gatilho já nasce SKIPPED com a frase: se o processo cair antes do chamado, a IA não pega a mensagem
          // e a reentrega retoma (abaixo).
          aiStatus: body && !hit && !tooOld ? 'PENDING' : 'SKIPPED',
          triggerPhraseId: hit?.phrase.id ?? null,
        },
      });
      rowId = row.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const seen = await this.prisma.whatsappMessage.findUnique({
        where: { externalId: m.externalId },
        select: { id: true, ticketId: true, triggerPhraseId: true },
      });
      if (!(hit && seen && seen.triggerPhraseId && !seen.ticketId)) {
        return { stored: false, ticketId: seen?.ticketId ?? null };
      }
      rowId = seen.id; // retomada de gatilho inacabado
    }
    if (!hit) return { stored: true, ticketId: null };

    // ponytail: lock em memória por instância (single-tenant, 1 backend); trocar por pg_advisory_xact_lock se escalar para várias instâncias
    const ticketId = await this.withLock(`${group.id}:${hit.phrase.id}`, async () => {
      const id = await this.openOrAttach(group, hit.phrase, hit.rest, m, senderUserId);
      await this.prisma.whatsappMessage.update({ where: { id: rowId }, data: { ticketId: id } });
      return id;
    });
    return { stored: true, ticketId };
  }

  private readonly locks = new Map<string, Promise<unknown>>();

  private withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    this.locks.set(key, run);
    const clean = () => {
      if (this.locks.get(key) === run) this.locks.delete(key);
    };
    run.then(clean, clean);
    return run;
  }

  /** Contato do cliente cujo telefone casa (pelos 8 últimos dígitos) com o do remetente. */
  private async findSender(clientId: string, senderPhone: string): Promise<string | null> {
    const key = phoneKey(senderPhone);
    if (!key) return null;
    const contacts = await this.prisma.user.findMany({
      where: { clientId, type: 'CLIENT', phone: { not: null } },
      select: { id: true, phone: true },
    });
    return contacts.find((c) => phoneKey(c.phone) === key)?.id ?? null;
  }

  /** Frases ativas do cliente; a mais longa que casa no início da mensagem vence. */
  private async matchTrigger(clientId: string, body: string) {
    const phrases = await this.prisma.triggerPhrase.findMany({ where: { clientId, active: true } });
    const byLength = [...phrases].sort((a, b) => b.phraseNorm.length - a.phraseNorm.length);
    for (const phrase of byLength) {
      const hit = matchStart(body, phrase.phraseNorm);
      if (hit) return { phrase, rest: hit.rest };
    }
    return null;
  }

  private async openOrAttach(
    group: WhatsappGroup,
    phrase: TriggerPhrase,
    rest: string,
    m: ParsedWhatsappMessage,
    senderUserId: string | null,
  ): Promise<string> {
    const open = await this.prisma.whatsappMessage.findFirst({
      where: {
        groupId: group.id,
        triggerPhraseId: phrase.id,
        ticketId: { not: null },
        ticket: { status: { notIn: [...TERMINAL] } },
      },
      orderBy: { sentAt: 'desc' },
      select: { ticketId: true },
    });
    if (open?.ticketId) {
      await this.events.record(this.prisma, open.ticketId, 'WHATSAPP_IN', {
        groupId: group.id,
        sender: m.senderName ?? m.senderPhone,
        text: m.body,
      });
      return open.ticketId;
    }

    const who = m.senderName ?? (m.senderPhone || 'desconhecido');
    const origin = `Origem: grupo WhatsApp "${group.name ?? group.externalId}" — ${who}${
      senderUserId ? '' : ' (remetente não identificado)'
    }`;
    const ticket = await this.tickets.create({
      origin: 'WHATSAPP',
      clientId: group.clientId,
      requesterId: senderUserId,
      title: phrase.title?.trim() || phrase.phrase,
      description: `${rest || m.body}\n\n${origin}`,
      categoryId: phrase.categoryId,
      priority: phrase.priority,
    });
    this.logger.log(`Chamado ${ticket.number} aberto por gatilho "${phrase.phrase}" no grupo ${group.id}.`);
    return ticket.id;
  }
}
