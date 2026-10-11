import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { SettingsService } from '../settings/settings.service.js';

export const MODEL = 'claude-haiku-5-5';

export interface ChatLine {
  sender: string;
  text: string;
}
export interface ClassifyInput {
  clientName: string;
  /** Mensagens anteriores, só para entender o assunto. NÃO são classificadas. */
  context: ChatLine[];
  /** Mensagens novas; a IA devolve índices (0..n-1) referentes a esta lista. */
  pending: ChatLine[];
}
export interface TriageItem {
  messageIndexes: number[];
  isRequest: boolean;
  urgency: number;
  sentiment: number;
  summary: string;
}
export interface ClassifyOutput {
  items: TriageItem[];
  inputTokens: number;
  outputTokens: number;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('Chave da API da Anthropic não configurada (Configurações > WhatsApp).');
    this.name = 'AiNotConfiguredError';
  }
}

/** IA indisponível/sem crédito/chave recusada: tentar de novo depois, sem gastar tentativas. */
export class AiTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiTransientError';
  }
}

// ponytail: duck-typing (os testes mockam o SDK; instanceof APIError não é confiável).
function toTransient(err: unknown): AiTransientError | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { status?: unknown; name?: unknown; code?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status !== undefined) {
    if (status === 401 || status === 403) return new AiTransientError(`Chave da API da Anthropic recusada (HTTP ${status})`);
    if ([408, 409, 429].includes(status) || status >= 500) return new AiTransientError(`IA indisponível (HTTP ${status})`);
    return null;
  }
  const conn =
    /Connection|Timeout/i.test(String(e.name ?? '')) ||
    /^(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR_.*)$/.test(String(e.code ?? ''));
  return conn ? new AiTransientError('IA indisponível (sem conexão)') : null;
}

// Faixas (1-5, -1..1) não vão no schema: restrições numéricas variam no suporte a saída
// estruturada. `sanitizeItems` aplica os limites depois.
const Schema = z.object({
  items: z.array(
    z.object({
      message_indexes: z.array(z.number()),
      is_request: z.boolean(),
      urgency: z.number(),
      sentiment: z.number(),
      summary: z.string(),
    }),
  ),
});

const SYSTEM_PROMPT = `Você faz a triagem de mensagens de um grupo de WhatsApp de suporte entre uma empresa de informática e segurança eletrônica e um cliente.

Para cada ASSUNTO distinto nas mensagens NOVAS, devolva um item com:
- message_indexes: os índices (como aparecem entre colchetes) das mensagens novas que compõem o assunto;
- is_request: true se o cliente pede ajuda, reporta um problema ou reclama; false para conversa, agradecimento ou simples informação;
- urgency: de 1 a 5 (5 = parada total ou segurança em risco; 3 = problema que atrapalha; 1 = pedido sem pressa);
- sentiment: de -1 (muito insatisfeito) a 1 (muito satisfeito);
- summary: uma frase objetiva em português para servir de título do chamado.

Use as mensagens de CONTEXTO apenas para entender o assunto; nunca as classifique. Mensagens sem conteúdo relevante não precisam de item. Não invente fatos.`;

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function buildUserPrompt(input: ClassifyInput): string {
  const ctx = input.context.length
    ? input.context.map((l) => `${oneLine(l.sender)}: ${oneLine(l.text)}`).join('\n')
    : '(sem contexto anterior)';
  const novas = input.pending.map((l, i) => `[${i}] ${oneLine(l.sender)}: ${oneLine(l.text)}`).join('\n');
  return `Cliente: ${input.clientName}\n\nContexto (já tratado — não classificar):\n${ctx}\n\nMensagens novas:\n${novas}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Aplica limites e descarta o que não faz sentido (índice inválido, resumo vazio). */
export function sanitizeItems(raw: unknown, pendingCount: number): TriageItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TriageItem[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    const idx = Array.isArray(o.messageIndexes) ? o.messageIndexes : [];
    const messageIndexes = [
      ...new Set(idx.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < pendingCount)),
    ].sort((a, b) => a - b);
    const summary = typeof o.summary === 'string' ? o.summary.trim() : '';
    if (!messageIndexes.length || !summary) continue;
    out.push({
      messageIndexes,
      isRequest: o.isRequest === true,
      urgency: Math.round(clamp(Number(o.urgency) || 1, 1, 5)),
      sentiment: clamp(Number(o.sentiment) || 0, -1, 1),
      summary,
    });
  }
  return out;
}

@Injectable()
export class AiClassifierService {
  constructor(private readonly settings: SettingsService) {}

  async classify(input: ClassifyInput): Promise<ClassifyOutput> {
    const apiKey = await this.settings.get('ai.anthropicApiKey');
    if (!apiKey) throw new AiNotConfiguredError();

    const client = new Anthropic({ apiKey });
    let response;
    try {
      response = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
        output_config: { effort: 'low', format: zodOutputFormat(Schema) },
      });
    } catch (err) {
      throw toTransient(err) ?? err;
    }
    if (response.stop_reason === 'max_tokens') throw new Error('Resposta da IA truncada (max_tokens).');
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      throw new Error('Resposta da IA recusada ou fora do formato.');
    }
    const items = response.parsed_output.items.map((i) => ({
      messageIndexes: i.message_indexes,
      isRequest: i.is_request,
      urgency: i.urgency,
      sentiment: i.sentiment,
      summary: i.summary,
    }));
    return {
      items: sanitizeItems(items, input.pending.length),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
