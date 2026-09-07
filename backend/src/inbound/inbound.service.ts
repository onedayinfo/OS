import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Ticket } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
import { ClientsService } from '../clients/clients.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { resolveClientReply } from '../tickets/ticket-status.service.js';
import { AttachmentsService } from '../attachments/attachments.service.js';
import type { UploadedFile } from '../attachments/storage.util.js';
import { stripQuotedText } from './email-body.util.js';
import type {
  ResendInboundAttachment,
  ResendInboundEmail,
  ResendInboundPayload,
} from './dto/resend-inbound.dto.js';

/** Campos já normalizados a partir do payload cru do Resend. */
type ParsedEmail = {
  messageId: string | null;
  fromEmail: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  attachments: ResendInboundAttachment[];
};

const NUMBER_IN_SUBJECT = /\[#(\d{4}-\d{4})\]/;
const MESSAGE_ID_TOKEN = /<[^>\s]+>/g;

@Injectable()
export class InboundService {
  private readonly logger = new Logger('InboundService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly clients: ClientsService,
    private readonly tickets: TicketsService,
    private readonly events: TicketEventsService,
    private readonly attachments: AttachmentsService,
  ) {}

  /** Fluxo do webhook inbound (spec §6.1). Idempotente por `messageId`. */
  async handle(payload: ResendInboundPayload): Promise<{ ticketId: string | null; deduped: boolean }> {
    const email = parsePayload(payload);

    // 2. Dedupe: já processamos esse Message-ID → no-op.
    if (email.messageId) {
      const seen = await this.prisma.inboundEmail.findUnique({
        where: { messageId: email.messageId },
      });
      if (seen) return { ticketId: seen.ticketId, deduped: true };
    }

    const body = stripQuotedText(email.text);

    // 3. Threading: In-Reply-To/References → InboundEmail conhecido; senão
    //    fallback pelo número no assunto.
    let ticket = await this.findThreadTicket(email);

    if (ticket) {
      // 4. Resposta a chamado existente: comentário PUBLIC + EMAIL_IN + eventual
      //    volta de WAITING_CLIENT para IN_PROGRESS.
      const authorId = await this.resolveAuthorId(ticket);
      const found = ticket;
      await this.prisma.$transaction(async (tx) => {
        await tx.ticketComment.create({
          data: { ticketId: found.id, authorId, body, visibility: 'PUBLIC' },
        });
        await this.events.record(tx, found.id, 'EMAIL_IN', {
          fromEmail: email.fromEmail,
          messageId: email.messageId,
        });
        await resolveClientReply(tx, found.id);
      });
    } else {
      // 5. Novo chamado.
      ticket = await this.createTicketFromEmail(email, body);
    }

    // 6. Anexos do e-mail. Falha de um anexo (MIME/tamanho) não derruba o webhook.
    await this.saveAttachments(ticket, email.attachments);

    // 7. Registra o InboundEmail (dedupe/threading futuros).
    await this.prisma.inboundEmail.create({
      data: {
        messageId: email.messageId ?? `no-message-id-${randomUUID()}`,
        ticketId: ticket.id,
        fromEmail: email.fromEmail,
        subject: email.subject,
        receivedAt: new Date(),
        headers: email.headers as Prisma.InputJsonValue,
      },
    });

    return { ticketId: ticket.id, deduped: false };
  }

  /** Casa o e-mail com um chamado já existente (threading). */
  private async findThreadTicket(email: ParsedEmail): Promise<Ticket | null> {
    const refIds = [
      ...extractMessageIds(email.headers['in-reply-to']),
      ...extractMessageIds(email.headers['references']),
    ];
    if (refIds.length) {
      const prior = await this.prisma.inboundEmail.findFirst({
        where: { messageId: { in: refIds }, ticketId: { not: null } },
        orderBy: { receivedAt: 'desc' },
      });
      if (prior?.ticketId) {
        const t = await this.prisma.ticket.findUnique({ where: { id: prior.ticketId } });
        if (t) return t;
      }
    }

    const m = NUMBER_IN_SUBJECT.exec(email.subject);
    if (m) return this.prisma.ticket.findUnique({ where: { number: m[1] } });

    return null;
  }

  /** Cria o chamado conforme o remetente casa (ou não) com contato/domínio. */
  private async createTicketFromEmail(email: ParsedEmail, body: string): Promise<Ticket> {
    const title = email.subject || '(sem assunto)';
    const user = await this.users.findByEmail(email.fromEmail);

    // Contato de cliente já cadastrado → usa como solicitante.
    if (user && user.type === 'CLIENT') {
      return this.tickets.create({
        origin: 'EMAIL',
        clientId: user.clientId,
        requesterId: user.id,
        title,
        description: body,
      });
    }

    // Sem contato: tenta casar o domínio com um cliente.
    const domain = email.fromEmail.split('@')[1]?.toLowerCase();
    const client = domain ? await this.clients.findByEmailDomain(domain) : null;
    if (client) {
      // Contato "não verificado": criado inativo, vinculado ao cliente.
      const contact = await this.prisma.user.create({
        data: {
          name: email.fromEmail,
          email: email.fromEmail,
          type: 'CLIENT',
          role: 'CONTACT',
          active: false,
          clientId: client.id,
        },
      });
      return this.tickets.create({
        origin: 'EMAIL',
        clientId: client.id,
        requesterId: contact.id,
        title,
        description: body,
      });
    }

    // Domínio desconhecido → fila de triagem. O `TicketsService.create` deriva
    // `needsTriage = true` de `origin EMAIL` sem cliente/solicitante.
    return this.tickets.create({
      origin: 'EMAIL',
      clientId: null,
      requesterId: null,
      title,
      description: body,
    });
  }

  private async saveAttachments(
    ticket: Ticket,
    attachments: ResendInboundAttachment[],
  ): Promise<void> {
    const files = toUploadedFiles(attachments);
    if (!files.length) return;
    const actor = await this.attachmentActor(ticket);
    for (const file of files) {
      try {
        await this.attachments.saveForTicket(ticket.id, file, actor);
      } catch (err) {
        this.logger.warn(
          `anexo "${file.originalname}" ignorado no chamado ${ticket.number}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Autor do comentário de resposta: o solicitante do chamado quando há; senão o
   * admin do seed (chamado de triagem ainda sem contato).
   */
  private async resolveAuthorId(ticket: Ticket): Promise<string> {
    if (ticket.requesterId) return ticket.requesterId;
    return this.seedAdminId();
  }

  /**
   * `Attachment.uploadedById` é obrigatório e `saveForTicket` roda a guarda de
   * acesso quando recebe `actor`. Montamos um actor sintético que passa nessa
   * guarda: o próprio solicitante (escopo "requester") ou o admin do seed
   * (escopo "all") para chamado de triagem.
   */
  private async attachmentActor(ticket: Ticket): Promise<Actor> {
    if (ticket.requesterId) {
      return {
        id: ticket.requesterId,
        type: 'CLIENT',
        role: 'CONTACT',
        clientId: ticket.clientId,
      };
    }
    return { id: await this.seedAdminId(), type: 'INTERNAL', role: 'AGENT', clientId: null };
  }

  private async seedAdminId(): Promise<string> {
    const admin = await this.users.findByEmail(process.env.SEED_ADMIN_EMAIL ?? '');
    if (!admin) {
      throw new Error('Admin do seed (SEED_ADMIN_EMAIL) não encontrado.');
    }
    return admin.id;
  }
}

/** Normaliza o payload cru (achatado ou em `data`) para `ParsedEmail`. */
export function parsePayload(payload: ResendInboundPayload): ParsedEmail {
  const d: ResendInboundEmail = payload.data ?? payload;
  const headers = normalizeHeaders(d.headers);

  const fromRaw = d.from;
  const fromEmail =
    typeof fromRaw === 'string'
      ? extractAddress(fromRaw)
      : (fromRaw?.email ?? fromRaw?.address ?? '').toLowerCase();

  const messageId =
    firstToken(headers['message-id']) ??
    d.messageId ??
    d.message_id ??
    null;

  return {
    messageId,
    fromEmail,
    subject: d.subject ?? '',
    text: d.text ?? '',
    headers,
    attachments: d.attachments ?? [],
  };
}

function normalizeHeaders(
  raw: ResendInboundEmail['headers'],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const h of raw) {
      if (h?.name) out[h.name.toLowerCase()] = h.value ?? '';
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

/** `<a@x>` de uma string de header (`In-Reply-To`, `References`, `Message-ID`). */
function extractMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  const tokens = value.match(MESSAGE_ID_TOKEN);
  return tokens ?? [];
}

function firstToken(value: string | undefined): string | null {
  return extractMessageIds(value)[0] ?? (value ? value.trim() : null) ?? null;
}

/** `"Fulano <fulano@x.com>"` → `fulano@x.com`; senão a própria string. */
function extractAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

function toUploadedFiles(attachments: ResendInboundAttachment[]): UploadedFile[] {
  return (attachments ?? []).flatMap((a) => {
    if (!a?.content) return [];
    const buffer = Buffer.from(a.content, 'base64');
    return [
      {
        originalname: a.filename ?? 'anexo',
        mimetype: a.content_type ?? a.contentType ?? 'application/octet-stream',
        size: buffer.length,
        buffer,
      },
    ];
  });
}
