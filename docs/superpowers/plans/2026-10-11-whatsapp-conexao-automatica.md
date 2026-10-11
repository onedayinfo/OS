# WhatsApp — conexão automática (assistente "Conectar WhatsApp") — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano task a task. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Goal:** O admin liga o WhatsApp só com cliques: um botão "Conectar / Reparar" cria a instância e o webhook da Evolution, o sistema gera o segredo, as chaves vêm do ambiente da stack, os grupos são escolhidos numa lista da Evolution e as frases de gatilho padrão já vêm cadastradas.

**Architecture:** Um `EvolutionClient` único (config + HTTP) passa a ser usado por status/QR, provisionamento e listagem de grupos. `EvolutionProvisioningService` executa 4 etapas idempotentes (alcançável → instância → webhook → pareado) e devolve um relatório de checklist; duas rotas ADMIN (`POST /whatsapp/connect`, `GET /whatsapp/setup`) e uma rota de grupos (`GET /whatsapp/evolution/groups`). Frontend: cartão de conexão em Configurações > WhatsApp e seletor de grupos na ficha do cliente. Seed único das 10 frases padrão. Release 0.12.1 junto com a correção pendente do erro de conexão da Anthropic.

**Tech Stack:** NestJS 12 (ESM, imports com `.js`), Prisma 6, vitest; Next.js 14 + React Query v5 + Tailwind; Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-whatsapp-conexao-automatica-design.md`

## Global Constraints

- Instância da Evolution é **sempre `os`** (padrão no código quando `whatsapp.evolution.instance` está vazio; a tela não pede mais).
- URL e chave da Evolution vêm do **ambiente**: `EVOLUTION_API_URL` (padrão `http://evolution-api:8080`) e `EVOLUTION_API_KEY`. **Ruling do plano (desvio consciente do spec §3):** quando a variável de ambiente existe, ela **prevalece** sobre o valor gravado na tela (a stack é a fonte da verdade); sem variável, vale o valor gravado. Custo se errado: nenhum (a tela deixa de editar o que o ambiente define).
- URL que a Evolution chama: `${WEBHOOK_BASE_URL (padrão http://backend:3001)}/api/whatsapp/webhook`, header `x-webhook-secret`, `events: ["MESSAGES_UPSERT"]`, `byEvents: false`, `base64: false`.
- Segredo do webhook: gerado pelo sistema (`randomBytes(32).toString('hex')`) só quando `whatsapp.webhookSecret` está vazio; gravado cifrado via `SettingsService.set`; **nunca** devolvido em respostas, relatórios ou mensagens de erro; nem a `EVOLUTION_API_KEY`.
- `connect()` é idempotente e serializado (trava em memória); o webhook é **sempre regravado**; a instância só é criada se não existir (resposta "já em uso" da Evolution = sucesso).
- Rotas: `POST /whatsapp/connect` e `GET /whatsapp/setup` `@Roles('ADMIN')`; `GET /whatsapp/evolution/groups` `@Roles('ADMIN','AGENT')`.
- Frases padrão: as 10 do spec §6 (globais, sem categoria), semeadas **uma vez** (flag `whatsapp.defaultPhrasesSeeded` em `Setting`); `phraseNorm` com a mesma normalização do `normalizeText`.
- Ids/rótulos que os e2e existentes usam NÃO podem mudar: `#wg-id`, `#wg-name`, botões 'Adicionar grupo', 'Nova frase', 'Salvar'.
- Textos de UI e erros em português do Brasil; comentários de código em português.
- Commits em Conventional Commits, em português, terminando com a linha `Co-Authored-By` exigida pelo ambiente. Trabalhar em `C:/Users/renan/os-exec` direto na `main`; **não** dar push, tag ou deploy (o controlador faz). Sempre prefixar chamadas Bash com `cd /c/Users/renan/os-exec/... &&` (o cwd da sessão volta para `Z:\Projetos\OS`). Postgres local no ar (`docker compose up -d postgres`).
- Um teste unitário antigo falha por motivo não relacionado: `src/tasks/contract-preventive.cron.spec.ts` — ignorar.

## Review Focus

1. `connect()` chamado duas vezes ao mesmo tempo (duplo clique) → serializado: **uma** criação de instância e relatórios coerentes (Task 3).
2. A Evolution responde "já em uso" ao criar uma instância que já existe (HTTP 403/409) → tratado como sucesso, não como erro (Task 3).
3. Nenhuma resposta, `detail` ou erro contém a `EVOLUTION_API_KEY` nem o segredo do webhook (Task 3).
4. Lista de grupos da Evolution com ids que não terminam em `@g.us`, formatos diferentes de nome/participantes ou corpo vazio → filtrados/normalizados sem quebrar; Evolution fora do ar → 502 com mensagem clara (Task 4).
5. Rodar o seed de novo depois de o admin apagar uma frase padrão **não** a ressuscita (Task 5).

---

## Mapa de arquivos

**Backend (criar):** `backend/src/whatsapp/evolution-client.ts` (+spec), `evolution-provisioning.service.ts` (+spec), `whatsapp-setup.controller.ts`, `evolution-groups.service.ts` (+spec), `backend/prisma/seed-phrases.ts` (+spec), `backend/src/whatsapp/ai-classifier.transient.spec.ts`.
**Backend (modificar):** `evolution-status.service.ts` (+spec), `whatsapp.module.ts`, `ai-classifier.service.ts`, `settings/settings.keys.ts` (+spec), `prisma/seed.ts`, `package.json`.
**Frontend (criar):** `components/whatsapp-connection-card.tsx`, `components/evolution-group-picker.tsx`, `e2e/whatsapp-conexao.spec.ts`.
**Frontend (modificar):** `lib/whatsapp.ts`, `app/app/config/tabs/whatsapp-tab.tsx`, `components/whatsapp-client-tab.tsx`, `package.json`.
**Infra/docs:** `portainer-stack.yml`, `docker-compose.yml`, `deploy/stack.env.example`, `deploy/README.md`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-11-whatsapp-conexao-automatica-design.md` (nota do ruling).

---

### Task 1: `EvolutionClient` e refatoração do status/QR

**Files:**
- Create: `backend/src/whatsapp/evolution-client.ts`, `backend/src/whatsapp/evolution-client.spec.ts`
- Modify: `backend/src/whatsapp/evolution-status.service.ts`, `backend/src/whatsapp/evolution-status.service.spec.ts`, `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DEFAULT_INSTANCE = 'os';
  export interface EvolutionConfig { url: string; apiKey: string; instance: string }
  export interface EvolutionResponse { ok: boolean; status: number; body: unknown; error?: string }
  class EvolutionClient {
    constructor(settings: SettingsService);
    config(): Promise<EvolutionConfig | null>;   // env prevalece; instância padrão 'os'
    request(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs?: number): Promise<EvolutionResponse>; // nunca lança
  }
  ```
- `EvolutionStatusService` mantém a API pública (`check()`, `qr()`), agora construído com `EvolutionClient`.

- [ ] **Step 1: Escrever o spec do cliente**

`evolution-client.spec.ts`:

```ts
import { DEFAULT_INSTANCE, EvolutionClient } from './evolution-client.js';

const settings = (vals: Record<string, string | undefined> = {}) => ({
  get: vi.fn().mockImplementation((k: string) => Promise.resolve(vals[k])),
});
const reply = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  vi.fn().mockResolvedValue({ ok: init.ok ?? true, status: init.status ?? 200, json: () => Promise.resolve(body) });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('EvolutionClient.config', () => {
  it('ambiente prevalece sobre a tela; instância padrão os; remove barras finais', async () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evolution-api:8080//');
    vi.stubEnv('EVOLUTION_API_KEY', 'ENVKEY');
    const c = new EvolutionClient(settings({ 'whatsapp.evolution.url': 'http://outro', 'whatsapp.evolution.apiKey': 'TELA' }) as any);
    expect(await c.config()).toEqual({ url: 'http://evolution-api:8080', apiKey: 'ENVKEY', instance: DEFAULT_INSTANCE });
  });

  it('sem ambiente usa o gravado na tela e respeita a instância configurada', async () => {
    const c = new EvolutionClient(
      settings({ 'whatsapp.evolution.url': 'http://x:8080', 'whatsapp.evolution.apiKey': 'K', 'whatsapp.evolution.instance': 'minha' }) as any,
    );
    expect(await c.config()).toEqual({ url: 'http://x:8080', apiKey: 'K', instance: 'minha' });
  });

  it('falta URL ou chave → null', async () => {
    expect(await new EvolutionClient(settings({ 'whatsapp.evolution.apiKey': 'K' }) as any).config()).toBeNull();
    expect(await new EvolutionClient(settings({ 'whatsapp.evolution.url': 'http://x' }) as any).config()).toBeNull();
  });
});

describe('EvolutionClient.request', () => {
  const cfg = { 'whatsapp.evolution.url': 'http://evo:8080', 'whatsapp.evolution.apiKey': 'K' };

  it('GET envia apikey e não manda corpo', async () => {
    const f = reply([{ name: 'os' }]);
    vi.stubGlobal('fetch', f);
    const r = await new EvolutionClient(settings(cfg) as any).request('GET', '/instance/fetchInstances');
    expect(r).toEqual({ ok: true, status: 200, body: [{ name: 'os' }] });
    expect(f.mock.calls[0][0]).toBe('http://evo:8080/instance/fetchInstances');
    expect(f.mock.calls[0][1].method).toBe('GET');
    expect(f.mock.calls[0][1].headers.apikey).toBe('K');
    expect(f.mock.calls[0][1].body).toBeUndefined();
  });

  it('POST serializa JSON com Content-Type', async () => {
    const f = reply({ ok: 1 }, { status: 201 });
    vi.stubGlobal('fetch', f);
    await new EvolutionClient(settings(cfg) as any).request('POST', '/webhook/set/os', { a: 1 });
    expect(f.mock.calls[0][1].body).toBe('{"a":1}');
    expect(f.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  });

  it('erro de rede nunca lança: status 0 e mensagem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await new EvolutionClient(settings(cfg) as any).request('GET', '/x')).toEqual({
      ok: false, status: 0, body: null, error: 'ECONNREFUSED',
    });
  });

  it('corpo que não é JSON vira body null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error('x')) }));
    expect(await new EvolutionClient(settings(cfg) as any).request('GET', '/x')).toEqual({ ok: false, status: 502, body: null });
  });

  it('não configurada → not_configured sem chamar fetch', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await new EvolutionClient(settings() as any).request('GET', '/x')).toEqual({ ok: false, status: 0, body: null, error: 'not_configured' });
    expect(f).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-client.spec.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar o cliente**

`evolution-client.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';

export const DEFAULT_INSTANCE = 'os';

export interface EvolutionConfig {
  url: string;
  apiKey: string;
  instance: string;
}

export interface EvolutionResponse {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

/** Único ponto de acesso à Evolution API: configuração + HTTP que nunca lança. */
@Injectable()
export class EvolutionClient {
  constructor(private readonly settings: SettingsService) {}

  /** Ambiente da stack prevalece; sem ele vale o gravado na tela. Instância padrão "os". */
  async config(): Promise<EvolutionConfig | null> {
    const url = process.env.EVOLUTION_API_URL || (await this.settings.get('whatsapp.evolution.url'));
    const apiKey = process.env.EVOLUTION_API_KEY || (await this.settings.get('whatsapp.evolution.apiKey'));
    const instance = (await this.settings.get('whatsapp.evolution.instance')) || DEFAULT_INSTANCE;
    return url && apiKey ? { url: url.replace(/\/+$/, ''), apiKey, instance } : null;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 8000,
  ): Promise<EvolutionResponse> {
    const c = await this.config();
    if (!c) return { ok: false, status: 0, body: null, error: 'not_configured' };
    try {
      const res = await fetch(`${c.url}${path}`, {
        method,
        headers: { apikey: c.apiKey, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        /* corpo vazio ou não JSON */
      }
      return { ok: res.ok, status: res.status, body: parsed };
    } catch (e) {
      return { ok: false, status: 0, body: null, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: Refatorar o `EvolutionStatusService`**

Reescrever `evolution-status.service.ts` para delegar ao cliente (mesmas regras e a mesma API pública; `disconnectedSince` e a lógica de estado ficam iguais):

```ts
import { Injectable } from '@nestjs/common';
import { EvolutionClient } from './evolution-client.js';

export interface WhatsappConnection {
  configured: boolean;
  state: string;
  disconnectedSince: string | null;
}

@Injectable()
export class EvolutionStatusService {
  // ponytail: instante da queda só em memória (reiniciar o backend zera). Persistir se virar auditoria.
  private disconnectedSince: Date | null = null;

  constructor(private readonly evo: EvolutionClient) {}

  async check(): Promise<WhatsappConnection> {
    const c = await this.evo.config();
    if (!c) return { configured: false, state: 'not_configured', disconnectedSince: null };

    let state = 'unreachable';
    const r = await this.evo.request('GET', `/instance/connectionState/${encodeURIComponent(c.instance)}`, undefined, 5000);
    if (r.ok) {
      const j = r.body as { instance?: { state?: string }; state?: string } | null;
      state = j?.instance?.state ?? j?.state ?? 'unknown';
    }
    if (state === 'open') this.disconnectedSince = null;
    else if (!this.disconnectedSince) this.disconnectedSince = new Date();
    return { configured: true, state, disconnectedSince: this.disconnectedSince?.toISOString() ?? null };
  }

  /** QR de pareamento (`GET /instance/connect/{instance}`). */
  async qr(): Promise<{ base64: string | null; pairingCode: string | null }> {
    const c = await this.evo.config();
    if (!c) return { base64: null, pairingCode: null };
    const r = await this.evo.request('GET', `/instance/connect/${encodeURIComponent(c.instance)}`, undefined, 10000);
    if (!r.ok) return { base64: null, pairingCode: null };
    const j = r.body as { base64?: string; pairingCode?: string } | null;
    return { base64: j?.base64 ?? null, pairingCode: j?.pairingCode ?? null };
  }
}
```

Em `evolution-status.service.spec.ts`: importar `EvolutionClient` e trocar toda construção `new EvolutionStatusService(settings(...) as any)` por `new EvolutionStatusService(new EvolutionClient(settings(...) as any))` (os testes e asserções ficam iguais — o `fetch` falso continua o mesmo). No `whatsapp.module.ts`, importar e registrar `EvolutionClient` em `providers` (antes de `EvolutionStatusService`).

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS (inclui os 4 testes antigos do status) e build limpo.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "refactor(whatsapp): EvolutionClient único (config do ambiente e HTTP) usado por status e QR"
```

---

### Task 2: Configuração do ambiente na stack

**Files:**
- Modify: `backend/src/settings/settings.keys.ts`, `backend/src/settings/settings.keys.spec.ts`, `portainer-stack.yml`, `docker-compose.yml`, `deploy/stack.env.example`, `docs/superpowers/specs/2026-10-11-whatsapp-conexao-automatica-design.md`, e `backend/.env.example` (se existir)

**Interfaces:**
- Produces: `ENV_FALLBACK['whatsapp.evolution.url'] = 'EVOLUTION_API_URL'`, `ENV_FALLBACK['whatsapp.evolution.apiKey'] = 'EVOLUTION_API_KEY'`; variáveis do backend na stack: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `WEBHOOK_BASE_URL`.

- [ ] **Step 1: Teste do fallback**

Acrescentar em `settings.keys.spec.ts`:

```ts
import { ENV_FALLBACK } from './settings.keys.js';

describe('fallback de ambiente da Evolution', () => {
  it('URL e chave da Evolution caem nas variáveis da stack', () => {
    expect(ENV_FALLBACK['whatsapp.evolution.url']).toBe('EVOLUTION_API_URL');
    expect(ENV_FALLBACK['whatsapp.evolution.apiKey']).toBe('EVOLUTION_API_KEY');
  });
});
```
(mesclar o import com o existente no topo do arquivo.)

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/settings/settings.keys.spec.ts` → FAIL.

- [ ] **Step 2: Implementar**

Em `settings.keys.ts`, no objeto `ENV_FALLBACK`, acrescentar:

```ts
  'whatsapp.evolution.url': 'EVOLUTION_API_URL',
  'whatsapp.evolution.apiKey': 'EVOLUTION_API_KEY',
```
Run de novo → PASS.

- [ ] **Step 3: Stack de produção**

Em `portainer-stack.yml`, no serviço `backend`, dentro de `environment:` (depois de `SEED_ADMIN_PASSWORD`), acrescentar:

```yaml
      # WhatsApp: o backend fala com a Evolution pela rede interna e diz a ela onde
      # entregar o webhook. A chave é a MESMA da Evolution (EVOLUTION_API_KEY).
      EVOLUTION_API_URL: ${EVOLUTION_API_URL:-http://evolution-api:8080}
      EVOLUTION_API_KEY: ${EVOLUTION_API_KEY:?defina EVOLUTION_API_KEY}
      WEBHOOK_BASE_URL: ${WEBHOOK_BASE_URL:-http://backend:3001}
```
e fazer o `backend` depender (sem condição de saúde) da Evolution **não** é necessário — não alterar `depends_on`.

- [ ] **Step 4: Compose de desenvolvimento**

Em `docker-compose.yml`, serviço `backend`, em `environment:` acrescentar:

```yaml
      EVOLUTION_API_URL: http://evolution-api:8080
      EVOLUTION_API_KEY: ${EVOLUTION_API_KEY:-dev-evolution-key}
      WEBHOOK_BASE_URL: http://backend:3001
```
Se existir `backend/.env.example`, acrescentar um bloco comentado explicando que, rodando o backend **fora** do Docker (`npm run start`), usar `EVOLUTION_API_URL=http://localhost:8080` e `WEBHOOK_BASE_URL=http://host.docker.internal:3001`.

- [ ] **Step 5: Docs de variáveis e nota no spec**

`deploy/stack.env.example`: sob o bloco do WhatsApp, comentar `EVOLUTION_API_URL` e `WEBHOOK_BASE_URL` como opcionais (padrões já cobrem a stack padrão). No spec §3, trocar a frase "O valor gravado na tela (se houver) continua prevalecendo; sem valor, vale o ambiente" por "**O ambiente prevalece** sobre o gravado na tela (a stack é a fonte da verdade); sem variável, vale o gravado".

- [ ] **Step 6: Validar compose**

Run:
```bash
cd /c/Users/renan/os-exec && docker compose -f portainer-stack.yml --env-file portainer-stack.env config > /dev/null && echo ok && docker compose config > /dev/null && echo ok-dev
```
Expected: `ok` e `ok-dev`.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/settings portainer-stack.yml docker-compose.yml deploy docs/superpowers/specs
[ -f backend/.env.example ] && git add backend/.env.example
git commit -m "feat(whatsapp): URL e chave da Evolution vêm do ambiente da stack"
```

---

### Task 3: Provisionamento (`connect` / `setup`)

**Files:**
- Create: `backend/src/whatsapp/evolution-provisioning.service.ts`, `backend/src/whatsapp/evolution-provisioning.service.spec.ts`, `backend/src/whatsapp/whatsapp-setup.controller.ts`
- Modify: `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Consumes: `EvolutionClient` (`config`, `request`), `EvolutionStatusService` (`check`, `qr`), `SettingsService` (`get`, `set`).
- Produces:
  ```ts
  export type StepId = 'reachable' | 'instance' | 'webhook' | 'connection';
  export interface SetupStep { id: StepId; label: string; status: 'ok' | 'error' | 'pending'; detail?: string }
  export interface SetupReport {
    steps: SetupStep[]; state: string;
    qr: { base64: string | null; pairingCode: string | null } | null;
    config: { urlFromEnv: boolean; apiKeyFromEnv: boolean; instance: string };
  }
  class EvolutionProvisioningService { connect(): Promise<SetupReport>; setup(): Promise<SetupReport> }
  ```
- Rotas: `POST /api/whatsapp/connect`, `GET /api/whatsapp/setup` (ADMIN).

> **Formatos da Evolution não confirmados em execução.** O código é tolerante (aceita as variações conhecidas de `fetchInstances`/`webhook/find`). Se o usuário trouxer respostas reais diferentes (ver a conversa/ledger), ajustar `instanceNames`, `alreadyExists` e o parse do `webhook/find` — não o contrato do relatório.

- [ ] **Step 1: Escrever o spec**

`evolution-provisioning.service.spec.ts`:

```ts
import { EvolutionProvisioningService } from './evolution-provisioning.service.js';

const OK = (body: unknown = []) => ({ ok: true, status: 200, body });
const WEBHOOK_URL = 'http://backend:3001/api/whatsapp/webhook';

function make(o: {
  responses?: Record<string, any>;
  settings?: Record<string, string | undefined>;
  state?: string;
  config?: any;
} = {}) {
  const calls: { method: string; path: string; body?: any }[] = [];
  const responses = { ...(o.responses ?? {}) };
  const evo = {
    config: vi.fn().mockResolvedValue(o.config === undefined ? { url: 'http://evolution-api:8080', apiKey: 'KEY123', instance: 'os' } : o.config),
    request: vi.fn().mockImplementation(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      await Promise.resolve();
      const r = responses[`${method} ${path}`];
      const out = typeof r === 'function' ? r(body) : r;
      return out ?? { ok: false, status: 404, body: null };
    }),
  };
  const store: Record<string, string | undefined> = { ...(o.settings ?? {}) };
  const settings = {
    get: vi.fn(async (k: string) => store[k]),
    set: vi.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
  };
  const status = {
    check: vi.fn().mockResolvedValue({ configured: true, state: o.state ?? 'open', disconnectedSince: null }),
    qr: vi.fn().mockResolvedValue({ base64: 'data:image/png;base64,AAA', pairingCode: null }),
  };
  const svc = new EvolutionProvisioningService(evo as any, settings as any, status as any);
  return { svc, calls, store, settings, status, responses };
}

const stepStatus = (r: any) => Object.fromEntries(r.steps.map((s: any) => [s.id, s.status]));

afterEach(() => vi.unstubAllEnvs());

describe('connect()', () => {
  it('tudo certo: instância já existe, webhook gravado com URL/header/eventos exatos, pareado', async () => {
    const { svc, calls, store } = make({ responses: {
      'GET /instance/fetchInstances': OK([{ name: 'os' }]),
      'POST /webhook/set/os': OK({}),
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'ok', webhook: 'ok', connection: 'ok' });
    expect(r.qr).toBeNull();
    expect(calls.some((c) => c.path === '/instance/create')).toBe(false);
    const hook = calls.find((c) => c.path === '/webhook/set/os')!;
    expect(hook.body).toEqual({
      webhook: {
        enabled: true,
        url: WEBHOOK_URL,
        byEvents: false,
        base64: false,
        headers: { 'x-webhook-secret': store['whatsapp.webhookSecret'] },
        events: ['MESSAGES_UPSERT'],
      },
    });
    expect(store['whatsapp.webhookSecret']).toMatch(/^[0-9a-f]{64}$/);
  });

  it('WEBHOOK_BASE_URL do ambiente muda a URL do webhook (sem barra final)', async () => {
    vi.stubEnv('WEBHOOK_BASE_URL', 'http://host.docker.internal:3001/');
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    await svc.connect();
    expect(calls.find((c) => c.path === '/webhook/set/os')!.body.webhook.url).toBe('http://host.docker.internal:3001/api/whatsapp/webhook');
  });

  it('instância inexistente é criada com o corpo certo', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: true, status: 201, body: {} },
      'POST /webhook/set/os': OK({}),
    } });
    const r = await svc.connect();
    expect(calls.find((c) => c.path === '/instance/create')!.body).toEqual({ instanceName: 'os', qrcode: true, integration: 'WHATSAPP-BAILEYS' });
    expect(stepStatus(r).instance).toBe('ok');
  });

  it('"já em uso" (403) ao criar conta como sucesso', async () => {
    const { svc } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: false, status: 403, body: { response: { message: ['This name "os" is already in use.'] } } },
      'POST /webhook/set/os': OK({}),
    } });
    expect(stepStatus(await svc.connect()).instance).toBe('ok');
  });

  it('falha ao criar a instância (500) para na etapa e deixa o resto pendente', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([]),
      'POST /instance/create': { ok: false, status: 500, body: null },
    } });
    const r = await svc.connect();
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'error', webhook: 'pending', connection: 'pending' });
    expect(calls.some((c) => c.path.startsWith('/webhook/set'))).toBe(false);
  });

  it('chave recusada (401): erro claro, sem vazar a chave, nada mais é chamado', async () => {
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': { ok: false, status: 401, body: null } } });
    const r = await svc.connect();
    expect(r.steps[0]).toMatchObject({ id: 'reachable', status: 'error' });
    expect(r.steps[0].detail).toMatch(/recusada/);
    expect(JSON.stringify(r)).not.toContain('KEY123');
    expect(calls).toHaveLength(1);
  });

  it('Evolution inalcançável (status 0)', async () => {
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': { ok: false, status: 0, body: null, error: 'ECONNREFUSED' } } });
    expect((await svc.connect()).steps[0].detail).toMatch(/inalcançável/);
  });

  it('não configurada: orienta a definir as variáveis', async () => {
    const { svc } = make({ config: null });
    const r = await svc.connect();
    expect(r.state).toBe('not_configured');
    expect(r.steps[0].detail).toMatch(/EVOLUTION_API_URL/);
  });

  it('segredo já existente não é regenerado', async () => {
    const { svc, settings } = make({
      settings: { 'whatsapp.webhookSecret': 'segredo-antigo' },
      responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) },
    });
    await svc.connect();
    expect(settings.set).not.toHaveBeenCalled();
  });

  it('falha ao gravar o segredo → erro no webhook sem expor o segredo', async () => {
    const { svc, settings } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    settings.set.mockRejectedValue(new Error('Defina APP_ENCRYPTION_KEY'));
    const r = await svc.connect();
    expect(stepStatus(r).webhook).toBe('error');
    expect(r.steps.find((s) => s.id === 'webhook')!.detail).toMatch(/APP_ENCRYPTION_KEY/);
  });

  it('despareado: conexão pendente e devolve o QR; pareado: sem QR', async () => {
    const closed = make({ state: 'close', responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    const r = await closed.svc.connect();
    expect(stepStatus(r).connection).toBe('pending');
    expect(r.qr).toEqual({ base64: 'data:image/png;base64,AAA', pairingCode: null });
    expect(r.state).toBe('close');
  });

  it('nunca expõe o segredo gerado nem a chave no relatório', async () => {
    const { svc, store } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]), 'POST /webhook/set/os': OK({}) } });
    const json = JSON.stringify(await svc.connect());
    expect(json).not.toContain(store['whatsapp.webhookSecret']!);
    expect(json).not.toContain('KEY123');
  });

  it('duas chamadas simultâneas são serializadas: a instância é criada uma vez só', async () => {
    const created = { v: false };
    const { svc, calls } = make({});
    const h = svc as any;
    h.evo.request.mockImplementation(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      await new Promise((r) => setTimeout(r, 5));
      if (method === 'GET' && path === '/instance/fetchInstances') return OK(created.v ? [{ name: 'os' }] : []);
      if (method === 'POST' && path === '/instance/create') { created.v = true; return { ok: true, status: 201, body: {} }; }
      if (method === 'POST' && path === '/webhook/set/os') return OK({});
      return { ok: false, status: 404, body: null };
    });
    await Promise.all([svc.connect(), svc.connect()]);
    expect(calls.filter((c) => c.path === '/instance/create')).toHaveLength(1);
    // a 2ª execução só começa depois da 1ª terminar (último POST do webhook da 1ª antes do 2º fetchInstances)
    const idxSecondList = calls.map((c, i) => (c.path === '/instance/fetchInstances' ? i : -1)).filter((i) => i >= 0)[1];
    const idxFirstHook = calls.findIndex((c) => c.path === '/webhook/set/os');
    expect(idxFirstHook).toBeLessThan(idxSecondList);
  });
});

describe('setup() (somente leitura)', () => {
  it('não faz nenhum POST; webhook ok quando o find devolve a mesma URL', async () => {
    const { svc, calls } = make({ responses: {
      'GET /instance/fetchInstances': OK([{ name: 'os' }]),
      'GET /webhook/find/os': OK({ enabled: true, url: WEBHOOK_URL }),
    } });
    const r = await svc.setup();
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(stepStatus(r)).toEqual({ reachable: 'ok', instance: 'ok', webhook: 'ok', connection: 'ok' });
  });

  it('webhook não consultável ou diferente fica pendente (não erro)', async () => {
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    const r = await svc.setup();
    expect(stepStatus(r).webhook).toBe('pending');
    expect(r.steps.find((s) => s.id === 'webhook')!.detail).toMatch(/Conectar/);
  });

  it('instância ausente: pendente, sem criar nada', async () => {
    const { svc, calls } = make({ responses: { 'GET /instance/fetchInstances': OK([]) } });
    const r = await svc.setup();
    expect(stepStatus(r).instance).toBe('pending');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('config reflete o ambiente', async () => {
    vi.stubEnv('EVOLUTION_API_URL', 'http://evolution-api:8080');
    vi.stubEnv('EVOLUTION_API_KEY', 'KEY123');
    const { svc } = make({ responses: { 'GET /instance/fetchInstances': OK([{ name: 'os' }]) } });
    expect((await svc.setup()).config).toEqual({ urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-provisioning.service.spec.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar o serviço**

`evolution-provisioning.service.ts`:

```ts
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
```

- [ ] **Step 4: Controller e módulo**

`whatsapp-setup.controller.ts`:

```ts
import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { EvolutionProvisioningService } from './evolution-provisioning.service.js';

@Controller('whatsapp')
export class WhatsappSetupController {
  constructor(private readonly provisioning: EvolutionProvisioningService) {}

  @Post('connect')
  @Roles('ADMIN')
  connect() {
    return this.provisioning.connect();
  }

  @Get('setup')
  @Roles('ADMIN')
  setup() {
    return this.provisioning.setup();
  }
}
```

Em `whatsapp.module.ts`: importar e adicionar `WhatsappSetupController` a `controllers` e `EvolutionProvisioningService` a `providers`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS e build limpo.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): provisionamento idempotente da Evolution (connect/setup)"
```

---

### Task 4: Grupos da Evolution

**Files:**
- Create: `backend/src/whatsapp/evolution-groups.service.ts`, `backend/src/whatsapp/evolution-groups.service.spec.ts`
- Modify: `backend/src/whatsapp/whatsapp-setup.controller.ts`, `backend/src/whatsapp/whatsapp.module.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EvolutionGroup { id: string; name: string; size: number | null; linkedClientId: string | null; linkedClientName: string | null }
  class EvolutionGroupsService { list(): Promise<EvolutionGroup[]> }   // 502 se a Evolution não responde
  ```
- Rota: `GET /api/whatsapp/evolution/groups` (`@Roles('ADMIN','AGENT')`).

- [ ] **Step 1: Spec**

```ts
import { BadGatewayException } from '@nestjs/common';
import { EvolutionGroupsService } from './evolution-groups.service.js';

function make(resp: any, linked: any[] = [], config: any = { url: 'u', apiKey: 'k', instance: 'os' }) {
  const evo = { config: vi.fn().mockResolvedValue(config), request: vi.fn().mockResolvedValue(resp) };
  const prisma = { whatsappGroup: { findMany: vi.fn().mockResolvedValue(linked) } };
  return { svc: new EvolutionGroupsService(evo as any, prisma as any), evo, prisma };
}

describe('EvolutionGroupsService.list', () => {
  it('normaliza nome/tamanho, ordena por nome e marca os já vinculados', async () => {
    const { svc, evo, prisma } = make(
      { ok: true, status: 200, body: [
        { id: '120363000000000002@g.us', subject: 'Zeta Suporte', size: 7 },
        { id: '120363000000000001@g.us', subject: 'Acme TI', participants: [{}, {}, {}] },
      ] },
      [{ externalId: '120363000000000001@g.us', client: { id: 'c1', name: 'Acme' } }],
    );
    const out = await svc.list();
    expect(evo.request.mock.calls[0][1]).toBe('/group/fetchAllGroups/os?getParticipants=false');
    expect(out).toEqual([
      { id: '120363000000000001@g.us', name: 'Acme TI', size: 3, linkedClientId: 'c1', linkedClientName: 'Acme' },
      { id: '120363000000000002@g.us', name: 'Zeta Suporte', size: 7, linkedClientId: null, linkedClientName: null },
    ]);
    expect(prisma.whatsappGroup.findMany.mock.calls[0][0].where).toEqual({
      externalId: { in: ['120363000000000002@g.us', '120363000000000001@g.us'] },
    });
  });

  it('ignora o que não é grupo e formatos estranhos; corpo vazio → lista vazia', async () => {
    const { svc } = make({ ok: true, status: 200, body: [
      { id: '5519999991234@s.whatsapp.net', subject: 'contato' },
      { subject: 'sem id' },
      null,
      { remoteJid: '120363000000000009@g.us', name: 'Outro formato' },
    ] });
    expect(await svc.list()).toEqual([
      { id: '120363000000000009@g.us', name: 'Outro formato', size: null, linkedClientId: null, linkedClientName: null },
    ]);
    expect(await make({ ok: true, status: 200, body: null }).svc.list()).toEqual([]);
  });

  it('Evolution fora do ar → 502; não configurada → 502; HTTP de erro → 502 com o status', async () => {
    await expect(make({ ok: false, status: 0, body: null }).svc.list()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(make({}, [], null).svc.list()).rejects.toThrow(/não configurada/i);
    await expect(make({ ok: false, status: 500, body: null }).svc.list()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/evolution-groups.service.spec.ts` → FAIL.

- [ ] **Step 3: Implementar**

`evolution-groups.service.ts`:

```ts
import { BadGatewayException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EvolutionClient } from './evolution-client.js';

export interface EvolutionGroup {
  id: string;
  name: string;
  size: number | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
}

@Injectable()
export class EvolutionGroupsService {
  constructor(
    private readonly evo: EvolutionClient,
    private readonly prisma: PrismaService,
  ) {}

  async list(): Promise<EvolutionGroup[]> {
    const c = await this.evo.config();
    if (!c) throw new BadGatewayException('Evolution não configurada.');
    const r = await this.evo.request(
      'GET',
      `/group/fetchAllGroups/${encodeURIComponent(c.instance)}?getParticipants=false`,
      undefined,
      15000,
    );
    if (!r.ok) {
      throw new BadGatewayException(r.status === 0 ? 'Evolution inalcançável.' : `A Evolution respondeu HTTP ${r.status}.`);
    }

    const raw = Array.isArray(r.body) ? r.body : [];
    const groups = raw.flatMap((g: any) => {
      const id = g?.id ?? g?.remoteJid ?? g?.jid;
      if (typeof id !== 'string' || !id.endsWith('@g.us')) return [];
      const size = typeof g?.size === 'number' ? g.size : Array.isArray(g?.participants) ? g.participants.length : null;
      return [{ id, name: String(g?.subject ?? g?.name ?? id), size }];
    });

    const linked = await this.prisma.whatsappGroup.findMany({
      where: { externalId: { in: groups.map((g) => g.id) } },
      select: { externalId: true, client: { select: { id: true, name: true } } },
    });
    const byId = new Map(linked.map((l) => [l.externalId, l.client]));

    return groups
      .map((g) => ({
        ...g,
        linkedClientId: byId.get(g.id)?.id ?? null,
        linkedClientName: byId.get(g.id)?.name ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }
}
```

- [ ] **Step 4: Rota e módulo**

Em `whatsapp-setup.controller.ts`: injetar `EvolutionGroupsService` no construtor e acrescentar

```ts
  @Get('evolution/groups')
  @Roles('ADMIN', 'AGENT')
  groups() {
    return this.groups.list();
  }
```
(importar `EvolutionGroupsService`; nomear o parâmetro `groups` → use `private readonly evoGroups` para não colidir com o método e chamar `this.evoGroups.list()`). Registrar `EvolutionGroupsService` em `providers` do `whatsapp.module.ts`.

- [ ] **Step 5: Rodar e ver passar** — `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build` → PASS.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "feat(whatsapp): listagem de grupos da Evolution com marcação dos já vinculados"
```

---

### Task 5: Frases de gatilho padrão (seed único)

**Files:**
- Create: `backend/prisma/seed-phrases.ts`, `backend/prisma/seed-phrases.spec.ts`
- Modify: `backend/prisma/seed.ts`

**Interfaces:**
- Produces: `DEFAULT_PHRASES` (10 itens), `normalizePhrase(s)`, `seedDefaultPhrases(prisma): Promise<{ created: number; skipped: boolean }>`.

- [ ] **Step 1: Spec**

`seed-phrases.spec.ts`:

```ts
import { DEFAULT_PHRASES, normalizePhrase, seedDefaultPhrases } from './seed-phrases.js';

function fake(initialFlag = false, existing: string[] = []) {
  const phrases = existing.map((phraseNorm) => ({ clientId: null, phraseNorm }));
  const state = { flag: initialFlag };
  const prisma = {
    setting: {
      findUnique: vi.fn(async () => (state.flag ? { key: 'whatsapp.defaultPhrasesSeeded', value: 'true' } : null)),
      create: vi.fn(async () => { state.flag = true; return {}; }),
    },
    triggerPhrase: {
      findFirst: vi.fn(async ({ where }: any) => phrases.find((p) => p.clientId === where.clientId && p.phraseNorm === where.phraseNorm) ?? null),
      create: vi.fn(async ({ data }: any) => { phrases.push(data); return data; }),
    },
  };
  return { prisma, phrases, state };
}

describe('seedDefaultPhrases', () => {
  it('tem as 10 frases aprovadas com as prioridades certas', () => {
    expect(DEFAULT_PHRASES.map((p) => [p.phrase, p.priority])).toEqual([
      ['Sistema caiu', 'URGENT'],
      ['Sem conexão', 'HIGH'],
      ['Sem internet', 'HIGH'],
      ['Wi-Fi caiu', 'HIGH'],
      ['Servidor fora do ar', 'URGENT'],
      ['Computador não liga', 'MEDIUM'],
      ['Impressora parada', 'MEDIUM'],
      ['Câmera offline', 'HIGH'],
      ['Alarme disparado', 'URGENT'],
      ['Cerca/portão parado', 'HIGH'],
    ]);
  });

  it('normaliza como o normalizeText do sistema', () => {
    expect(normalizePhrase('  Sem   Conexão ')).toBe('sem conexao');
    expect(normalizePhrase('Cerca/portão parado')).toBe('cerca/portao parado');
  });

  it('primeira execução cria as 10 globais sem categoria e grava a flag', async () => {
    const { prisma, phrases, state } = fake();
    expect(await seedDefaultPhrases(prisma as any)).toEqual({ created: 10, skipped: false });
    expect(phrases).toHaveLength(10);
    expect(phrases[0]).toMatchObject({ clientId: null, phrase: 'Sistema caiu', phraseNorm: 'sistema caiu', priority: 'URGENT', categoryId: null });
    expect(state.flag).toBe(true);
  });

  it('segunda execução não faz nada; apagar uma frase não a ressuscita', async () => {
    const { prisma, phrases } = fake();
    await seedDefaultPhrases(prisma as any);
    phrases.splice(0, 1); // admin apagou "Sistema caiu"
    expect(await seedDefaultPhrases(prisma as any)).toEqual({ created: 0, skipped: true });
    expect(phrases).toHaveLength(9);
  });

  it('não duplica uma frase global que já existe (flag ausente)', async () => {
    const { prisma, phrases } = fake(false, ['sem internet']);
    const r = await seedDefaultPhrases(prisma as any);
    expect(r.created).toBe(9);
    expect(phrases.filter((p) => p.phraseNorm === 'sem internet')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd /c/Users/renan/os-exec/backend && npx vitest run prisma/seed-phrases.spec.ts` → FAIL.

- [ ] **Step 3: Implementar**

`seed-phrases.ts`:

```ts
import type { PrismaClient, TicketPriority } from '@prisma/client';

const FLAG = 'whatsapp.defaultPhrasesSeeded';

export const DEFAULT_PHRASES: { phrase: string; priority: TicketPriority }[] = [
  { phrase: 'Sistema caiu', priority: 'URGENT' },
  { phrase: 'Sem conexão', priority: 'HIGH' },
  { phrase: 'Sem internet', priority: 'HIGH' },
  { phrase: 'Wi-Fi caiu', priority: 'HIGH' },
  { phrase: 'Servidor fora do ar', priority: 'URGENT' },
  { phrase: 'Computador não liga', priority: 'MEDIUM' },
  { phrase: 'Impressora parada', priority: 'MEDIUM' },
  { phrase: 'Câmera offline', priority: 'HIGH' },
  { phrase: 'Alarme disparado', priority: 'URGENT' },
  { phrase: 'Cerca/portão parado', priority: 'HIGH' },
];

/** Mesma regra do `normalizeText` do sistema (src/whatsapp/text.util.ts). */
export function normalizePhrase(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Semeia as frases de gatilho globais UMA vez. A flag em `Setting` impede que uma frase
 * apagada pelo admin volte no próximo boot (o seed roda a cada subida do container).
 */
export async function seedDefaultPhrases(
  prisma: Pick<PrismaClient, 'setting' | 'triggerPhrase'>,
): Promise<{ created: number; skipped: boolean }> {
  if (await prisma.setting.findUnique({ where: { key: FLAG } })) return { created: 0, skipped: true };

  let created = 0;
  for (const p of DEFAULT_PHRASES) {
    const phraseNorm = normalizePhrase(p.phrase);
    // NULL não conflita no índice único: a duplicidade das globais é checada aqui.
    if (await prisma.triggerPhrase.findFirst({ where: { clientId: null, phraseNorm } })) continue;
    await prisma.triggerPhrase.create({
      data: { clientId: null, phrase: p.phrase, phraseNorm, priority: p.priority, categoryId: null, title: null },
    });
    created++;
  }
  await prisma.setting.create({ data: { key: FLAG, value: 'true', encrypted: false } });
  return { created, skipped: false };
}
```

- [ ] **Step 4: Ligar ao seed**

Em `prisma/seed.ts`: `import { seedDefaultPhrases } from './seed-phrases.js';` e, em `main()`, logo **depois** do loop de categorias e **antes** da leitura de `SEED_ADMIN_EMAIL` (para rodar mesmo sem credenciais de admin):

```ts
  const phrases = await seedDefaultPhrases(prisma);
  console.log(phrases.skipped ? 'Frases padrão do WhatsApp: já semeadas.' : `Frases padrão do WhatsApp: ${phrases.created} criadas.`);
```

- [ ] **Step 5: Verificar de verdade**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run prisma/seed-phrases.spec.ts && npx prisma db seed && npx prisma db seed`
Expected: spec PASS; 1ª execução imprime "N criadas" (ou "já semeadas" se o banco de dev já tiver a flag) e a 2ª imprime "já semeadas". Se `./seed-phrases.js` não resolver no `tsx`, trocar o import para `./seed-phrases` e anotar no relatório. Confira depois: `npx prisma studio` não é necessário; basta um `SELECT` via `docker compose exec postgres psql` se quiser.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/prisma
git commit -m "feat(whatsapp): frases de gatilho padrão semeadas uma única vez"
```

---

### Task 6: Erros de conexão do SDK da Anthropic são transitórios

**Files:**
- Modify: `backend/src/whatsapp/ai-classifier.service.ts`
- Create: `backend/src/whatsapp/ai-classifier.transient.spec.ts`

**Interfaces:**
- Produces: `toTransient(err: unknown): AiTransientError | null` **exportada** (hoje é interna), agora reconhecendo `APIConnectionError`/`APIConnectionTimeoutError` reais do SDK.

Contexto (achado parkeado da fase anterior): no SDK instalado, `APIConnectionError` e `APIConnectionTimeoutError` não definem `name` (fica `"Error"`), chamam `super(undefined, …)` (status indefinido) e a mensagem é `"Connection error."` / `"Request timed out."` (a causa vai em `cause`). A detecção por `name` não os pega; uma queda de rede da Anthropic ainda conta tentativa e vira `FAILED` após 3 rodadas.

- [ ] **Step 1: Spec sem mock do SDK**

`ai-classifier.transient.spec.ts` (NÃO usar `vi.mock('@anthropic-ai/sdk')` neste arquivo):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { AiTransientError, toTransient } from './ai-classifier.service.js';

describe('toTransient com erros REAIS do SDK', () => {
  it('APIConnectionError → transitório', () => {
    const e = new Anthropic.APIConnectionError({ cause: new Error('socket hang up') });
    expect(toTransient(e)).toBeInstanceOf(AiTransientError);
  });

  it('APIConnectionTimeoutError → transitório', () => {
    expect(toTransient(new Anthropic.APIConnectionTimeoutError())).toBeInstanceOf(AiTransientError);
  });

  it('erro HTTP 429 e 400 continuam como antes', () => {
    expect(toTransient({ status: 429, message: 'x' })).toBeInstanceOf(AiTransientError);
    expect(toTransient({ status: 400, message: 'x' })).toBeNull();
  });

  it('Error comum sem status/nome de conexão não é transitório', () => {
    expect(toTransient(new Error('resposta fora do formato'))).toBeNull();
  });
});
```

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp/ai-classifier.transient.spec.ts`
Expected: FAIL (`toTransient` não exportada e/ou conexão não reconhecida).

- [ ] **Step 2: Implementar**

Em `ai-classifier.service.ts`: ler a função `toTransient` atual e (a) exportá-la (`export function toTransient`), (b) estender a detecção sem remover as regras existentes: além do que já reconhece (status 401/403/408/409/429/≥500; `name`/`code` de conexão), tratar como conexão/timeout quando `e.constructor?.name` ∈ {`APIConnectionError`, `APIConnectionTimeoutError`} **ou** `e.message` ∈ {`Connection error.`, `Request timed out.`} **ou** `e.cause?.code` casa `/^(ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|UND_ERR_)/`. A mensagem do `AiTransientError` para esses casos é `IA indisponível (sem conexão)`.

- [ ] **Step 3: Rodar tudo do módulo**

Run: `cd /c/Users/renan/os-exec/backend && npx vitest run src/whatsapp && npm run build`
Expected: PASS (inclui os testes antigos de `ai-classifier.service.spec.ts`, que fabricam erros por duck-typing e devem continuar passando) e build limpo.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/renan/os-exec && git add backend/src/whatsapp
git commit -m "fix(whatsapp): erros de conexão e timeout reais do SDK da Anthropic são transitórios"
```

---

### Task 7: Frontend — cartão de conexão em Configurações

**Files:**
- Modify: `frontend/src/lib/whatsapp.ts`
- Create: `frontend/src/components/whatsapp-connection-card.tsx`
- Modify: `frontend/src/app/app/config/tabs/whatsapp-tab.tsx`

**Interfaces:**
- Produces (`lib/whatsapp.ts`): tipos `SetupStep`, `SetupReport`; hooks `useSetup()`, `useConnect()`, `useEvolutionGroups(enabled)`, tipo `EvolutionGroup`.

- [ ] **Step 1: `lib/whatsapp.ts`**

Acrescentar ao final do arquivo:

```ts
// --- assistente de conexão ---
export interface SetupStep {
  id: 'reachable' | 'instance' | 'webhook' | 'connection';
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

export function useSetup() {
  return useQuery({
    queryKey: ['wa-setup'],
    queryFn: () => api<SetupReport>('/whatsapp/setup'),
    // enquanto não estiver pareado, acompanha o pareamento
    refetchInterval: (q) => (q.state.data?.state === 'open' ? false : 5000),
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SetupReport>('/whatsapp/connect', { method: 'POST' }),
    onSuccess: (report) => {
      qc.setQueryData(['wa-setup'], report);
      qc.invalidateQueries({ queryKey: ['wa-status'] });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// --- grupos da Evolution ---
export interface EvolutionGroup {
  id: string;
  name: string;
  size: number | null;
  linkedClientId: string | null;
  linkedClientName: string | null;
}

export function useEvolutionGroups(enabled: boolean) {
  return useQuery({
    queryKey: ['wa-evo-groups'],
    queryFn: () => api<EvolutionGroup[]>('/whatsapp/evolution/groups'),
    enabled,
    retry: false,
    staleTime: 0,
  });
}
```

- [ ] **Step 2: Cartão**

`components/whatsapp-connection-card.tsx`:

```tsx
'use client';

import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useConnect, useSetup, type SetupStep } from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const MARK: Record<SetupStep['status'], string> = { ok: '✓', error: '✗', pending: '•' };
const TONE: Record<SetupStep['status'], 'green' | 'red' | 'neutral'> = { ok: 'green', error: 'red', pending: 'neutral' };

export function WhatsappConnectionCard() {
  const { data: report, isLoading, isError } = useSetup();
  const connect = useConnect();

  return (
    <section className="flex max-w-lg flex-col gap-3 rounded-xl bg-card p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold">Conexão com o WhatsApp</h2>

      {isLoading && <p className="text-sm text-muted-foreground">Verificando…</p>}
      {isError && <p className="text-sm text-destructive">Não foi possível consultar a conexão agora.</p>}

      {report && (
        <ul className="flex flex-col gap-2" aria-label="Etapas da conexão">
          {report.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <Badge tone={TONE[s.status]}>{MARK[s.status]}</Badge>
              <div>
                <div className="font-medium">{s.label}</div>
                {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button
        className="self-start"
        disabled={connect.isPending}
        onClick={() =>
          connect.mutate(undefined, {
            onSuccess: (r) => {
              const falhou = r.steps.find((s) => s.status === 'error');
              if (falhou) toast.error(falhou.detail ?? 'Falha ao conectar.');
              else toast.success(r.state === 'open' ? 'WhatsApp conectado.' : 'Configuração concluída. Escaneie o QR code.');
            },
            onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao conectar.'),
          })
        }
      >
        {connect.isPending ? 'Conectando…' : 'Conectar / Reparar'}
      </Button>

      {report?.qr?.base64?.startsWith('data:image/') && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={report.qr.base64} alt="QR code do WhatsApp" className="h-56 w-56 rounded border border-border bg-white p-2" />
      )}
      {report?.qr?.pairingCode && (
        <p className="text-sm">
          Código de pareamento: <b>{report.qr.pairingCode}</b>
        </p>
      )}
      {report && report.state !== 'open' && report.state !== 'not_configured' && (
        <p className="text-xs text-muted-foreground">
          No celular dedicado: WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho. O estado atualiza sozinho.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Reescrever a aba**

Em `whatsapp-tab.tsx`:
- `import { WhatsappConnectionCard } from '@/components/whatsapp-connection-card';` e `useSetup` de `@/lib/whatsapp`.
- Remover do `form`/estado/payload/UI: `instance`, `webhookSecret`, e o botão/estado/`fetchQr`/`qr` do QR antigo (o cartão cuida disso). Remover também `STATE_LABEL`, `Badge` se ficarem sem uso.
- Substituir a seção "Conexão" por `<WhatsappConnectionCard />` seguido da linha de uso da IA (preservar exatamente o bloco `{ai && (<p ...>IA hoje ...</p>)}` com o aviso `lastError`) dentro de uma `<section className="flex max-w-lg flex-col gap-3">` própria.
- A seção "Evolution API" passa a depender de `const { data: setup } = useSetup();`:
  - Campo "URL interna": se `setup?.config.urlFromEnv`, mostrar `<p className="text-sm text-muted-foreground">URL configurada pelo ambiente da stack.</p>`; senão o `Input` atual.
  - Campo "Chave da API da Evolution": idem com `apiKeyFromEnv` ("Chave configurada pelo ambiente da stack."); senão o `Input` atual.
  - Se **ambos** vierem do ambiente, a seção inteira vira só um parágrafo "Evolution configurada pelo ambiente da stack." (sem inputs).
  - O payload do `save` só inclui `whatsapp.evolution.url`/`apiKey` quando o respectivo campo está visível.
- O resto (IA, retenção, frases padrão, botão Salvar) permanece.

- [ ] **Step 4: Verificar**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): cartão Conectar WhatsApp com checklist e QR em Configurações"
```

---

### Task 8: Frontend — escolher grupo da Evolution

**Files:**
- Create: `frontend/src/components/evolution-group-picker.tsx`
- Modify: `frontend/src/components/whatsapp-client-tab.tsx`

**Interfaces:**
- Consumes: `useEvolutionGroups(enabled)`, `EvolutionGroup`.
- Produces: `<EvolutionGroupPicker open onClose onPick={(g: EvolutionGroup) => void} />`.

- [ ] **Step 1: Seletor**

`evolution-group-picker.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useEvolutionGroups, type EvolutionGroup } from '@/lib/whatsapp';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function EvolutionGroupPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (g: EvolutionGroup) => void;
}) {
  const { data, isLoading, error } = useEvolutionGroups(open);
  const [q, setQ] = useState('');
  const list = (data ?? []).filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog open={open} onClose={onClose} title="Escolher grupo da Evolution">
      <div className="flex flex-col gap-3">
        <Input aria-label="Buscar grupo" placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} />
        {isLoading && <p className="text-sm text-muted-foreground">Carregando grupos…</p>}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Não foi possível listar os grupos.'} Cole o ID manualmente.
          </p>
        )}
        {data && list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum grupo encontrado.</p>}
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {list.map((g) => {
            const blocked = !!g.linkedClientId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    onPick(g);
                    onClose();
                  }}
                  className="flex w-full flex-col rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.size != null ? `${g.size} participantes · ` : ''}
                    {blocked ? `já vinculado a ${g.linkedClientName}` : g.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
```

- [ ] **Step 2: Ligar na aba do cliente**

Em `whatsapp-client-tab.tsx` (manter `#wg-id`, `#wg-name`, 'Adicionar grupo' intactos):
- `import { EvolutionGroupPicker } from '@/components/evolution-group-picker';` e `const [picking, setPicking] = useState(false);`
- No formulário de adicionar grupo, antes do botão `Adicionar grupo`, acrescentar `<Button type="button" variant="outline" onClick={() => setPicking(true)}>Escolher da Evolution</Button>`.
- No fim da `<section>` dos grupos: `<EvolutionGroupPicker open={picking} onClose={() => setPicking(false)} onPick={(g) => { setExternalId(g.id); setName(g.name); }} />`.

- [ ] **Step 3: Verificar**

Run: `cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit && npm run build` → sem erros.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/src
git commit -m "feat(frontend): escolher grupo da Evolution na ficha do cliente"
```

---

### Task 9: E2E do assistente (rotas interceptadas)

**Files:**
- Create: `frontend/e2e/whatsapp-conexao.spec.ts`

**Interfaces:**
- Consumes: login de admin dos outros specs; Playwright `page.route`.

- [ ] **Step 1: Escrever o spec**

```ts
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_CLIENT_ID } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

const steps = (webhook: 'ok' | 'error' | 'pending', connection: 'ok' | 'pending') => [
  { id: 'reachable', label: 'Evolution alcançável', status: 'ok' },
  { id: 'instance', label: 'Instância criada', status: 'ok', detail: 'Já existia' },
  { id: 'webhook', label: 'Webhook configurado', status: webhook, detail: webhook === 'ok' ? undefined : 'Clique em Conectar' },
  { id: 'connection', label: 'WhatsApp pareado', status: connection },
];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('assistente de conexão e seletor de grupos da Evolution (com a API da Evolution simulada)', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const grupoLivre = { id: `${stamp}1@g.us`, name: `Suporte Livre ${stamp}`, size: 12, linkedClientId: null, linkedClientName: null };
  const grupoUsado = { id: `${stamp}2@g.us`, name: `Grupo Usado ${stamp}`, size: 4, linkedClientId: 'x', linkedClientName: 'Outro Cliente' };

  await page.route('**/api/whatsapp/setup', (route) =>
    route.fulfill({ json: { steps: steps('pending', 'pending'), state: 'close', qr: null, config: { urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' } } }),
  );
  await page.route('**/api/whatsapp/connect', (route) =>
    route.fulfill({ json: { steps: steps('ok', 'pending'), state: 'close', qr: { base64: PNG, pairingCode: null }, config: { urlFromEnv: true, apiKeyFromEnv: true, instance: 'os' } } }),
  );
  await page.route('**/api/whatsapp/evolution/groups', (route) => route.fulfill({ json: [grupoLivre, grupoUsado] }));

  await loginAsAdmin(page);

  // 1. Configurações > WhatsApp: checklist e Conectar / Reparar
  await page.goto('/app/config');
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await expect(page.getByText('Evolution alcançável')).toBeVisible();
  await expect(page.getByText('Webhook configurado')).toBeVisible();
  await expect(page.getByText('Evolution configurada pelo ambiente da stack.')).toBeVisible();
  await page.getByRole('button', { name: 'Conectar / Reparar' }).click();
  await expect(page.getByAltText('QR code do WhatsApp')).toBeVisible();

  // 2. Ficha do cliente: escolher grupo da Evolution preenche o ID e o apelido
  await page.goto(`/app/clientes/${E2E_CLIENT_ID}`);
  await page.getByRole('button', { name: 'WhatsApp' }).click();
  await page.getByRole('button', { name: 'Escolher da Evolution' }).click();
  const dialog = page.getByRole('dialog', { name: 'Escolher grupo da Evolution' });
  await expect(dialog.getByText(grupoLivre.name)).toBeVisible();
  await expect(dialog.getByRole('button', { name: new RegExp(grupoUsado.name) })).toBeDisabled();
  await dialog.getByRole('button', { name: new RegExp(grupoLivre.name) }).click();
  await expect(page.locator('#wg-id')).toHaveValue(grupoLivre.id);
  await expect(page.locator('#wg-name')).toHaveValue(grupoLivre.name);
});
```

- [ ] **Step 2: Rodar**

Com backend (`cd /c/Users/renan/os-exec/backend && npm run build && node dist/main`, em segundo plano) e frontend buildado no ar (ver `frontend/playwright.config.ts`):
Run: `cd /c/Users/renan/os-exec/frontend && npx playwright test e2e/whatsapp-conexao.spec.ts`
Expected: PASS. Encerrar os processos depois (Windows: `netstat -ano | grep :3001` + `taskkill //PID <pid> //F`); portas 3000/3001 livres ao final. Lembrete: o login tem limite de 10/min em memória; se der 429, reiniciar o backend e esperar um minuto.

- [ ] **Step 3: Commit**

```bash
cd /c/Users/renan/os-exec && git add frontend/e2e
git commit -m "test(e2e): assistente de conexão do WhatsApp e seletor de grupos (Evolution simulada)"
```

---

### Task 10: Documentação e release 0.12.1

**Files:**
- Modify: `deploy/README.md`, `CHANGELOG.md`, `backend/package.json`, `frontend/package.json`, `docs/roadmap.md`

- [ ] **Step 1: README de deploy**

Reescrever a seção "WhatsApp (Evolution API)" de `deploy/README.md`:
1. Variáveis da stack: `EVOLUTION_API_KEY` (`openssl rand -hex 32`) e `EVOLUTION_DB_PASSWORD` (só letras/números); opcionais `EVOLUTION_API_URL` e `WEBHOOK_BASE_URL` (os padrões servem a stack padrão).
2. Depois do redeploy: **Configurações > WhatsApp > Conectar / Reparar**; escanear o QR no celular dedicado; o estado atualiza sozinho.
3. Chave da Anthropic em Configurações > WhatsApp; salvar.
4. Em cada cliente: aba WhatsApp > "Escolher da Evolution" para vincular o grupo; "Aplicar frases padrão".
5. As frases padrão já vêm cadastradas (Configurações > WhatsApp > Frases padrão).
6. Manter os avisos (API não oficial/chip separado; LGPD) e acrescentar: "Se algo falhar, o checklist mostra a etapa e o motivo; clique em Conectar / Reparar de novo. Os antigos comandos `node -e` não são mais necessários."

- [ ] **Step 2: CHANGELOG e versões**

`CHANGELOG.md`: nova seção `## [0.12.1] - 2026-10-11` acima da `[0.12.0]`:

```markdown
### Adicionado
- **Assistente "Conectar WhatsApp"** (Configurações > WhatsApp): cria a instância e o
  webhook da Evolution, gera o segredo do webhook e mostra um checklist com o QR code;
  botão "Conectar / Reparar" repetível.
- URL e chave da Evolution vêm do ambiente da stack (`EVOLUTION_API_URL`,
  `EVOLUTION_API_KEY`; opcional `WEBHOOK_BASE_URL`). O ambiente prevalece sobre a tela.
- **Escolher grupo da Evolution** na aba WhatsApp do cliente (lista com busca; marca os
  grupos já vinculados).
- **Frases de gatilho padrão** (10) semeadas uma única vez.

### Corrigido
- Erros reais de conexão/timeout do SDK da Anthropic agora são tratados como
  indisponibilidade transitória (as mensagens ficam na fila em vez de virar FAILED).

### Alterado
- Saem da tela o nome da instância (fixo `os`) e o segredo do webhook (gerado).
```
`backend/package.json` e `frontend/package.json`: `"version": "0.12.1"` (mesmo padrão do commit 0.12.0: lockfiles não mudam). `docs/roadmap.md`: marcar "buscar grupos da Evolution" como entregue na 0.12.1.

- [ ] **Step 3: Suítes completas**

Run:
```bash
cd /c/Users/renan/os-exec/backend && npx vitest run && npm run test:integration && npm run build
cd /c/Users/renan/os-exec/frontend && npx tsc --noEmit && npm run build
```
Expected: tudo verde, exceto a falha antiga (`contract-preventive.cron.spec.ts`, nomeá-la). Não rodar a suíte Playwright inteira (feita na Task 9 só para o spec novo).

- [ ] **Step 4: Boot real**

Run: `cd /c/Users/renan/os-exec/backend && (node dist/main > /tmp/os-boot.log 2>&1 &); sleep 25; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/whatsapp/webhook -d '{}'; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3001/api/whatsapp/connect; tail -n 5 /tmp/os-boot.log`
Expected: `401` e `401` (rota ADMIN sem token), sem erro de DI no log. Encerrar o processo e liberar a porta 3001.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/renan/os-exec && git add -A deploy CHANGELOG.md backend/package.json frontend/package.json docs/roadmap.md
git commit -m "chore(release): 0.12.1 - assistente de conexão do WhatsApp"
```

> **Fora do plano (decisão do usuário):** tag `v0.12.1`, `OS_TAG`, build/push das imagens e redeploy no Portainer; e a validação real com a Evolution (clicar Conectar numa stack de verdade, parear, escolher grupo, mandar "Sistema caiu").

---

## Auto-revisão

**Cobertura do spec:** §3 configuração do ambiente (T1 `EvolutionClient.config`, T2 `ENV_FALLBACK`/stack/compose; ruling "ambiente prevalece" registrado no plano e no spec) ✔; segredo gerado e nunca exposto (T3) ✔; instância fixa `os` (T1) ✔. §4 `connect()` 4 etapas idempotentes + `setup()` só leitura + rotas ADMIN (T3) ✔; concorrência (T3 teste) ✔. §5 grupos da Evolution + marcação dos vinculados + 502 + seletor na ficha (T4, T8) ✔. §6 seed único das 10 frases + flag + sem ressuscitar (T5) ✔. §7 tela (cartão, campos de ambiente recolhidos, segredo/instância removidos) (T7) ✔. §8 erros (T3 testes de falha por etapa, segredo perdido regenera, concorrência) ✔. §9 testes (unit T1–T6, e2e T9, manual pós-deploy fora do plano) ✔. §10 ordem ✔; item 7 do §10 (README, CHANGELOG, 0.12.1 + correção da Anthropic) (T6, T10) ✔. §11 riscos herdados: Anthropic (T6); backup (fora, task separada).

**Placeholders:** nenhum. Os pontos que dependem de resposta real da Evolution (formatos de `fetchInstances`, `webhook/find`, `fetchAllGroups`, "já em uso") estão tratados com parse tolerante e sinalizados na T3/T4 para ajuste caso o usuário traga respostas diferentes.

**Consistência de tipos/nomes:** `SetupReport`/`SetupStep`/`config.{urlFromEnv,apiKeyFromEnv,instance}` iguais em T3 (backend), T7 (lib e cartão) e T9 (mocks do e2e); `EvolutionGroup` igual em T4, T7 (lib) e T8; `DEFAULT_INSTANCE`/`EvolutionClient` de T1 usados em T3/T4; rotas `/whatsapp/connect|setup|evolution/groups` iguais em controllers e hooks; `toTransient` exportada em T6.
