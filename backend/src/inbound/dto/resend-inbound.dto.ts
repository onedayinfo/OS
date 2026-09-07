/**
 * Forma (parcial) do payload do webhook inbound do Resend. O e-mail já vem
 * parseado. Mantemos os campos tolerantes: aceitamos tanto o payload "achatado"
 * quanto embrulhado em `data`, e `headers` como array `{name,value}` ou objeto.
 *
 * Não é uma classe `class-validator`: a validação de verdade aqui é a assinatura
 * HMAC do corpo cru (ver `inbound.controller.ts`). O `ValidationPipe` global tem
 * `whitelist: true` e removeria campos aninhados não decorados — por isso o
 * controller lê o JSON do corpo cru direto, sem `@Body()`.
 */
export interface ResendInboundAttachment {
  filename?: string;
  /** Conteúdo em base64. */
  content?: string;
  content_type?: string;
  contentType?: string;
}

export interface ResendInboundEmail {
  from?: string | { address?: string; email?: string; name?: string };
  subject?: string;
  text?: string;
  html?: string;
  messageId?: string;
  message_id?: string;
  headers?: Array<{ name: string; value: string }> | Record<string, string>;
  attachments?: ResendInboundAttachment[];
  'in-reply-to'?: string;
  references?: string;
}

export interface ResendInboundPayload extends ResendInboundEmail {
  type?: string;
  data?: ResendInboundEmail;
}
