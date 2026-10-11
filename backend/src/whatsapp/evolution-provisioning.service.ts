import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { DEFAULT_INSTANCE, EvolutionClient } from './evolution-client.js';
import type { EvolutionResponse } from './evolution-client.js';
import { EvolutionStatusService } from './evolution-status.service.js';

export type StepId = 'reachable' | 'instance' | 'webhook' | 'connection';

export interface SetupStep {
  id: StepId;
  label: string;
  status: 'ok' | 'error' | 'pending';
  detail?: string;
}

export interface SetupReport {
  steps: SetupStep[];
  state: string;
  qr: { base64: string | null; pairingCode: string | null } | null;
  config: { urlFromEnv: boolean; apiKeyFromEnv: boolean; instance: string };
}

const ORDER: StepId[] = ['reachable', 'instance', 'webhook', 'connection'];
const LABELS: Record<StepId, string> = {
  reachable: 'Evolution alcançável',
  instance: 'Instância criada',
  webhook: 'Webhook configurado',
  connection: 'WhatsApp pareado',
};

/** Nomes de instância em `fetchInstances` — tolera as formas conhecidas da Evolution v2. */
function instanceNames(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((x) => (x as any)?.name ?? (x as any)?.instanceName ?? (x as any)?.instance?.instanceName)
    .filter((n): n is string => typeof n === 'string');
}

/** A Evolution responde 403/409 "already in use" ao criar uma instância repetida. */
function alreadyExists(r: EvolutionResponse): boolean {
  return !r.ok && [403, 409].includes(r.status) && JSON.stringify(r.body ?? '').toLowerCase().includes('already');
}

function reachDetail(r: EvolutionResponse, url: string): string {
  if (r.status === 0) return `Evolution inalcançável em ${url}`;
  if (r.status === 401 || r.status === 403) return `Chave da Evolution recusada (HTTP ${r.status})`;
  return `Evolution respondeu HTTP ${r.status}`;
}

@Injectable()
export class EvolutionProvisioningService {
  // ponytail: trava em memória (1 backend, single-tenant); trocar por lock no banco se escalar para várias instâncias.
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly evo: EvolutionClient,
    private readonly settings: SettingsService,
    private readonly status: EvolutionStatusService,
  ) {}

  /** Executa as etapas gravando o que faltar. Idempotente e serializado. */
  connect(): Promise<SetupReport> {
    const run = this.chain.catch(() => undefined).then(() => this.execute(true));
    this.chain = run;
    return run;
  }

  /** Mesmo checklist, só leitura (não cria nem grava nada). */
  setup(): Promise<SetupReport> {
    return this.execute(false);
  }

  private webhookUrl(): string {
    const base = (process.env.WEBHOOK_BASE_URL || 'http://backend:3001').replace(/\/+$/, '');
    return `${base}/api/whatsapp/webhook`;
  }

  private async execute(mutate: boolean): Promise<SetupReport> {
    const c = await this.evo.config();
    const config = {
      urlFromEnv: !!process.env.EVOLUTION_API_URL,
      apiKeyFromEnv: !!process.env.EVOLUTION_API_KEY,
      instance: c?.instance ?? DEFAULT_INSTANCE,
    };
    const steps: SetupStep[] = ORDER.map((id) => ({ id, label: LABELS[id], status: 'pending' as const }));
    const mark = (id: StepId, status: SetupStep['status'], detail?: string) => {
      const s = steps.find((x) => x.id === id)!;
      s.status = status;
      s.detail = detail;
    };
    const report = (state: string, qr: SetupReport['qr'] = null): SetupReport => ({ steps, state, qr, config });

    if (!c) {
      mark('reachable', 'error', 'Evolution não configurada: defina EVOLUTION_API_URL e EVOLUTION_API_KEY na stack.');
      return report('not_configured');
    }
    const inst = encodeURIComponent(c.instance);

    // 1. alcançável (e já traz a lista de instâncias)
    const list = await this.evo.request('GET', '/instance/fetchInstances');
    if (!list.ok) {
      mark('reachable', 'error', reachDetail(list, c.url));
      return report('unreachable');
    }
    mark('reachable', 'ok');

    // 2. instância
    if (instanceNames(list.body).includes(c.instance)) {
      mark('instance', 'ok', 'Já existia');
    } else if (!mutate) {
      mark('instance', 'pending', 'Ainda não criada — clique em Conectar');
      return report('unknown');
    } else {
      const created = await this.evo.request('POST', '/instance/create', {
        instanceName: c.instance,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      });
      if (created.ok) mark('instance', 'ok', 'Criada');
      else if (alreadyExists(created)) mark('instance', 'ok', 'Já existia');
      else {
        mark('instance', 'error', `Falha ao criar a instância (HTTP ${created.status})`);
        return report('unknown');
      }
    }

    // 3. webhook
    const url = this.webhookUrl();
    if (mutate) {
      let secret = await this.settings.get('whatsapp.webhookSecret');
      if (!secret) {
        secret = randomBytes(32).toString('hex');
        try {
          await this.settings.set('whatsapp.webhookSecret', secret);
        } catch (e) {
          mark('webhook', 'error', `Não foi possível gravar o segredo do webhook (${(e as Error).message}). Confira APP_ENCRYPTION_KEY.`);
          return report('unknown');
        }
      }
      const r = await this.evo.request('POST', `/webhook/set/${inst}`, {
        webhook: {
          enabled: true,
          url,
          byEvents: false,
          base64: false,
          headers: { 'x-webhook-secret': secret },
          events: ['MESSAGES_UPSERT'],
        },
      });
      if (r.ok) mark('webhook', 'ok');
      else {
        mark('webhook', 'error', `Falha ao configurar o webhook (HTTP ${r.status})`);
        return report('unknown');
      }
    } else {
      const f = await this.evo.request('GET', `/webhook/find/${inst}`);
      const b = f.body as any;
      const current = b?.webhook?.url ?? b?.url;
      const enabled = (b?.webhook?.enabled ?? b?.enabled) !== false;
      if (f.ok && current === url && enabled) mark('webhook', 'ok');
      else mark('webhook', 'pending', 'Não verificado ou diferente do esperado — clique em Conectar');
    }

    // 4. pareamento
    const conn = await this.status.check();
    if (conn.state === 'open') {
      mark('connection', 'ok');
      return report('open');
    }
    mark('connection', 'pending', conn.state === 'unreachable' ? 'A Evolution não respondeu' : 'Escaneie o QR code com o celular dedicado');
    const qr = await this.status.qr();
    return report(conn.state, qr.base64 || qr.pairingCode ? qr : null);
  }
}
