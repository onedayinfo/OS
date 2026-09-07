import type { Ticket, TicketComment } from '@prisma/client';

// ponytail: template = função pura -> { subject, html }. HTML mínimo, pt-BR.
// Sem MJML/handlebars: template string basta para 7 e-mails transacionais.

export interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Escapa `& < > " '` para uso seguro dentro de HTML/atributo. `&` primeiro.
 * Todo valor dinâmico interpolado no `html` dos templates passa por aqui
 * (conteúdo de comentário é PUBLIC / vem do inbound — nunca confiável).
 */
export function escapeHtml(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const esc = escapeHtml;

const wrap = (title: string, body: string): string =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">` +
  `<h2 style="font-size:16px;margin:0 0 12px">${title}</h2>${body}</div>`;

const ticketRef = (t: Pick<Ticket, 'number'>): string => `[#${t.number}]`;

export function ticketCreated(ticket: Ticket): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} ${ticket.title}`,
    html: wrap(
      'Chamado aberto',
      `<p>Seu chamado <strong>${esc(ticketRef(ticket))}</strong> foi aberto e está com status <strong>${esc(ticket.status)}</strong>.</p>` +
        `<p>Responda a este e-mail para adicionar informações ao chamado.</p>`,
    ),
  };
}

export function ticketCreatedInternal(ticket: Ticket): RenderedEmail {
  return {
    subject: `Novo chamado ${ticketRef(ticket)} ${ticket.title}`,
    html: wrap(
      'Novo chamado na fila',
      `<p>Chamado <strong>${esc(ticketRef(ticket))}</strong> criado.</p>` +
        `<p>Prioridade: <strong>${esc(ticket.priority)}</strong> — Status: <strong>${esc(ticket.status)}</strong>.</p>`,
    ),
  };
}

export function ticketComment(ticket: Ticket, comment: TicketComment): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} ${ticket.title}`,
    html: wrap(
      'Novo andamento no chamado',
      `<p>Há um novo andamento no chamado <strong>${esc(ticketRef(ticket))}</strong> — ${esc(ticket.title)}:</p>` +
        `<blockquote style="border-left:3px solid #ccc;margin:0;padding:0 0 0 12px;color:#333">${esc(comment.body).replace(/\n/g, '<br>')}</blockquote>`,
    ),
  };
}

export function ticketAssigned(ticket: Ticket): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} atribuído a você`,
    html: wrap(
      'Chamado atribuído',
      `<p>O chamado <strong>${esc(ticketRef(ticket))}</strong> — ${esc(ticket.title)} — foi atribuído a você.</p>`,
    ),
  };
}

export function ticketResolved(ticket: Ticket): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} resolvido`,
    html: wrap(
      'Chamado resolvido',
      `<p>O chamado <strong>${esc(ticketRef(ticket))}</strong> — ${esc(ticket.title)} — foi marcado como resolvido.</p>` +
        `<p>Se o problema persistir, responda a este e-mail para reabrir.</p>`,
    ),
  };
}

export function ticketSlaBreached(ticket: Ticket): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} — SLA vencido`,
    html: wrap(
      'SLA vencido',
      `<p>O prazo de SLA do chamado <strong>${esc(ticketRef(ticket))}</strong> — ${esc(ticket.title)} — venceu.</p>`,
    ),
  };
}

export function contactInvite(user: { name: string; email: string }, link: string): RenderedEmail {
  return {
    subject: 'Defina sua senha de acesso',
    html: wrap(
      `Olá, ${esc(user.name)}`,
      `<p>Use o link abaixo para definir sua senha (válido por 7 dias):</p>` +
        `<p><a href="${esc(link)}">${esc(link)}</a></p>`,
    ),
  };
}
