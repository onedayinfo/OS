import { phoneFromJid } from '../common/phone.util.js';

export type WhatsappMessageKind = 'TEXT' | 'AUDIO' | 'IMAGE' | 'OTHER';

export interface ParsedWhatsappMessage {
  externalId: string;
  groupJid: string;
  /** '' quando o remetente não tem telefone resolvível (ex.: LID). */
  senderPhone: string;
  senderName: string | null;
  type: WhatsappMessageKind;
  body: string | null;
  sentAt: Date;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Obj = Record<string, any>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;

/**
 * Converte o webhook `messages.upsert` da Evolution em uma mensagem de GRUPO nossa.
 * Devolve null para tudo que não nos interessa (outro evento, conversa individual,
 * mensagem enviada pelo próprio celular, payload sem id).
 */
export function parseEvolutionMessage(payload: unknown): ParsedWhatsappMessage | null {
  if (!isObj(payload)) return null;
  const event = String(payload.event ?? '').toLowerCase().replace(/_/g, '.');
  if (event !== 'messages.upsert') return null;

  const d: unknown = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!isObj(d) || !isObj(d.key)) return null;
  const key = d.key;

  const groupJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  if (!groupJid.endsWith('@g.us') || key.fromMe === true) return null;
  if (typeof key.id !== 'string' || !key.id) return null;

  const m: Obj = isObj(d.message) ? d.message : {};
  const text: unknown =
    m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? null;
  const body = typeof text === 'string' && text.trim() ? text : null;
  const type: WhatsappMessageKind = m.audioMessage ? 'AUDIO' : m.imageMessage ? 'IMAGE' : body ? 'TEXT' : 'OTHER';

  // Contas com LID: o telefone real, quando existe, vem em participantPn/senderPn.
  const senderJid = key.participantPn ?? key.senderPn ?? key.participant ?? d.participant;
  const ts = Number(isObj(d.messageTimestamp) ? d.messageTimestamp.low : d.messageTimestamp);

  return {
    externalId: `${groupJid}:${key.id}`,
    groupJid,
    senderPhone: phoneFromJid(typeof senderJid === 'string' ? senderJid : null) ?? '',
    senderName: typeof d.pushName === 'string' && d.pushName ? d.pushName : null,
    type,
    body,
    sentAt: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
  };
}
