# Configurações do sistema (Resend, S3, backup, aparência) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levar configuração de Resend, armazenamento S3, backup de dados e aparência (logo/nome/cor) do `.env` para a tela de Configurações do app, com segredos criptografados no banco.

**Architecture:** Um `SettingsService` (tabela `Setting` chave→valor, cache em memória, AES-256-GCM para segredos, fallback pro `.env` legado) vira a fonte de config em runtime. Um `StorageService` com drivers disk/S3 abstrai onde os anexos são gravados. `BackupService` serializa/restaura todas as tabelas em JSON. `BrandingController` público serve nome/cor/logo (logo em base64 no banco). Frontend ganha 4 abas novas em `/app/config` e um provider de branding no layout raiz.

**Tech Stack:** NestJS 12 (ESM, imports com `.js`), Prisma 6 / Postgres, `@aws-sdk/client-s3` (dep nova, única), `crypto` nativo, Next.js App Router + React Query + Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-configuracoes-sistema-design.md`

## Global Constraints

- **Runtime:** Node ESM. Todo import relativo de arquivo `.ts` do backend termina em `.js`. Prisma 6, NestJS 12.
- **Idioma:** toda string visível ao usuário (mensagens de erro da API, labels, toasts, textos de commit, CHANGELOG) em **português do Brasil**.
- **Dependências novas:** apenas `@aws-sdk/client-s3`. Nada de `@nestjs/config` expandido, nada de lib de cripto, backup ou upload. SigV4 não se reimplementa.
- **Segredos:** `resend.apiKey`, `resend.inboundSecret`, `storage.s3.accessKeyId`, `storage.s3.secretAccessKey` gravados como blob `v1:<ivB64>:<tagB64>:<ctB64>` (AES-256-GCM). Chave: env `APP_ENCRYPTION_KEY` = base64 de 32 bytes.
- **Fallback:** quando a chave não existe no banco, `SettingsService.get` lê `process.env[<env legado>]`. Env legado (`RESEND_API_KEY`, `MAIL_FROM`, `RESEND_INBOUND_SECRET`, `STORAGE_PATH`, `APP_URL`) continua funcionando.
- **Acesso:** todos os endpoints novos de config/backup são `@Roles('ADMIN')`. `GET /branding` e `GET /branding/logo` são `@Public()`.
- **Instância única:** sem locks distribuídos em cron/cache (mesma premissa do `SlaBreachCron`). Comentar com `ponytail:` onde o teto importa.
- **Testes:** vitest, sem fixtures/framework novo. Cada lógica não-trivial (cripto, fallback, cache, dual-read, export/import, poda) deixa ao menos um teste. `npm test` no backend precisa ficar verde ao fim de cada task.
- **Versão:** Conventional Commits por step. Ao fim, bump para `0.2.0` + CHANGELOG (Keep a Changelog).
- **Ambiente:** execução em `C:/Users/renan/os-exec`. `git push` é sempre seguido de `git -C "Z:/Projetos/OS" pull --ff-only origin main`.
- **Prisma:** após editar `schema.prisma`, rodar `npx prisma migrate dev --name <nome>` e `npx prisma generate` (o `postinstall` já gera, mas gere explícito após migrar).

---

## Mapa de arquivos

**Backend — criar:**
- `backend/src/settings/crypto.util.ts` — AES-256-GCM `encrypt`/`decrypt` + `demo()` self-check.
- `backend/src/settings/settings.keys.ts` — catálogo de chaves, set de segredos, mapa env legado.
- `backend/src/settings/settings.service.ts` — store chave→valor, cache, cripto, fallback.
- `backend/src/settings/settings.controller.ts` — `GET/PUT /settings`, `POST /settings/storage/test`, `POST/DELETE /settings/branding/logo`, `POST /settings/email/test`.
- `backend/src/settings/settings.module.ts`
- `backend/src/settings/dto/update-settings.dto.ts`
- `backend/src/storage/storage.types.ts` — interface `StorageDriver`.
- `backend/src/storage/disk.driver.ts`
- `backend/src/storage/s3.driver.ts`
- `backend/src/storage/storage.service.ts`
- `backend/src/storage/storage.module.ts`
- `backend/src/branding/branding.controller.ts`
- `backend/src/branding/branding.module.ts`
- `backend/src/backup/backup.service.ts`
- `backend/src/backup/backup.controller.ts`
- `backend/src/backup/backup.cron.ts`
- `backend/src/backup/backup.module.ts`
- Specs `*.spec.ts` ao lado de cada um acima que tenha lógica.
- `backend/test/integration/backup.integration.spec.ts`
- `backend/test/integration/settings.integration.spec.ts`

**Backend — modificar:**
- `backend/prisma/schema.prisma` — model `Setting`.
- `backend/src/app.module.ts` — importar `SettingsModule`, `StorageModule`, `BrandingModule`, `BackupModule`.
- `backend/src/email/email.module.ts` / `email.service.ts` / `templates.ts` — ler config do `SettingsService`; logo+nome nos templates.
- `backend/src/email/email.service.spec.ts` — stub de `SettingsService`.
- `backend/src/inbound/inbound.controller.ts` / `inbound.controller.spec.ts` — secret via `SettingsService`.
- `backend/src/attachments/attachments.service.ts` / `attachments.controller.ts` — gravar/ler via `StorageService`.
- `backend/src/attachments/attachments.module.ts` — importar `StorageModule`.
- `backend/src/tasks/tasks.module.ts` — registrar `BackupCron`.
- `backend/src/app.controller.ts` (se houver healthcheck que valha reportar estado da chave — opcional, não obrigatório).

**Frontend — criar:**
- `frontend/src/lib/branding.ts` — `getBranding()` (server + client).
- `frontend/src/components/brand-mark.tsx` — `<BrandMark>` (logo ou texto).
- `frontend/src/app/app/config/tabs/email-tab.tsx`
- `frontend/src/app/app/config/tabs/storage-tab.tsx`
- `frontend/src/app/app/config/tabs/backup-tab.tsx`
- `frontend/src/app/app/config/tabs/appearance-tab.tsx`

**Frontend — modificar:**
- `frontend/src/app/layout.tsx` — `generateMetadata()` + injeção de `--primary` e favicon.
- `frontend/src/components/nav.tsx` — `AppNav`/`PortalNav` usam `<BrandMark>`.
- `frontend/src/components/login-form.tsx` — logo/nome no topo.
- `frontend/src/app/app/config/page.tsx` — 4 abas novas, gated por `role === 'ADMIN'`.

**Docs — modificar (última task):**
- `deploy/stack.env.example`, `README.md`, `CHANGELOG.md`, `backend/package.json` + `frontend/package.json` (versão).

---

## Task 1: Utilitário de criptografia (AES-256-GCM)

**Files:**
- Create: `backend/src/settings/crypto.util.ts`
- Test: `backend/src/settings/crypto.util.spec.ts`

**Interfaces:**
- Consumes: `process.env.APP_ENCRYPTION_KEY` (base64 de 32 bytes).
- Produces:
  - `encrypt(plain: string): string` → `"v1:<ivB64>:<tagB64>:<ctB64>"`.
  - `decrypt(blob: string): string` — lança `Error` se o formato/tag forem inválidos.
  - `isEncryptionKeySet(): boolean`.
  - `class EncryptionKeyMissingError extends Error`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/settings/crypto.util.spec.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt, EncryptionKeyMissingError, isEncryptionKeySet } from './crypto.util.js';

const KEY = Buffer.alloc(32, 7).toString('base64'); // 32 bytes determinísticos

describe('crypto.util', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
  });

  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const blob = encrypt('rk_live_segredo');
    expect(blob.startsWith('v1:')).toBe(true);
    expect(decrypt(blob)).toBe('rk_live_segredo');
  });

  it('dois encrypts do mesmo texto geram blobs diferentes (IV aleatório)', () => {
    expect(encrypt('x')).not.toBe(encrypt('x'));
  });

  it('tag adulterada faz o decrypt lançar', () => {
    const blob = encrypt('x');
    const parts = blob.split(':');
    parts[2] = Buffer.alloc(16, 0).toString('base64'); // tag zerada
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('formato inválido lança', () => {
    expect(() => decrypt('naoehblob')).toThrow();
  });

  it('sem APP_ENCRYPTION_KEY: encrypt lança EncryptionKeyMissingError e isEncryptionKeySet=false', () => {
    delete process.env.APP_ENCRYPTION_KEY;
    expect(isEncryptionKeySet()).toBe(false);
    expect(() => encrypt('x')).toThrow(EncryptionKeyMissingError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/settings/crypto.util.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// backend/src/settings/crypto.util.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ENV = 'APP_ENCRYPTION_KEY';
const ALGO = 'aes-256-gcm';

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super(`Defina ${ENV} (base64 de 32 bytes) para gravar segredos nas configurações.`);
    this.name = 'EncryptionKeyMissingError';
  }
}

function key(): Buffer {
  const raw = process.env[ENV];
  if (!raw) throw new EncryptionKeyMissingError();
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${ENV} deve ser base64 de exatamente 32 bytes (recebido ${buf.length}).`);
  }
  return buf;
}

export function isEncryptionKeySet(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** `plain` -> `v1:<ivB64>:<tagB64>:<ctB64>` */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(blob: string): string {
  const [v, ivB64, tagB64, ctB64] = blob.split(':');
  if (v !== 'v1' || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Blob criptografado em formato inválido.');
  }
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Self-check executável: `tsx src/settings/crypto.util.ts` */
export function demo(): void {
  process.env[ENV] ??= Buffer.alloc(32, 1).toString('base64');
  const blob = encrypt('segredo-demo');
  if (decrypt(blob) !== 'segredo-demo') throw new Error('round-trip falhou');
  const bad = blob.split(':');
  bad[3] = Buffer.from('outro').toString('base64');
  try {
    decrypt(bad.join(':'));
    throw new Error('adulteração não detectada');
  } catch {
    /* esperado */
  }
  console.log('crypto.util demo OK');
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npx vitest run src/settings/crypto.util.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/settings/crypto.util.ts backend/src/settings/crypto.util.spec.ts
git commit -m "feat(settings): utilitário AES-256-GCM para segredos de configuração"
```

---

## Task 2: Catálogo de chaves + model `Setting` + `SettingsService`

**Files:**
- Create: `backend/src/settings/settings.keys.ts`
- Create: `backend/src/settings/settings.service.ts`
- Create: `backend/src/settings/settings.module.ts`
- Create: `backend/src/settings/settings.service.spec.ts`
- Modify: `backend/prisma/schema.prisma` (model `Setting`)
- Modify: `backend/src/app.module.ts` (importar `SettingsModule`)

**Interfaces:**
- Consumes: `PrismaService`; `encrypt`/`decrypt`/`isEncryptionKeySet` da Task 1.
- Produces:
  - `SETTING_KEYS: readonly string[]` — todas as chaves conhecidas.
  - `SECRET_KEYS: ReadonlySet<string>` — `resend.apiKey`, `resend.inboundSecret`, `storage.s3.accessKeyId`, `storage.s3.secretAccessKey`.
  - `ENV_FALLBACK: Readonly<Record<string,string>>` — `{'resend.apiKey':'RESEND_API_KEY','mail.from':'MAIL_FROM','resend.inboundSecret':'RESEND_INBOUND_SECRET','storage.path':'STORAGE_PATH'}`.
  - `class SettingsService`:
    - `get(key: string): Promise<string | undefined>`
    - `getBool(key: string): Promise<boolean>` (`'true'` → true)
    - `getNumber(key: string): Promise<number | undefined>`
    - `getMany(keys: string[]): Promise<Record<string, string | undefined>>`
    - `set(key: string, value: string, opts?: { encrypt?: boolean }): Promise<void>` — string vazia em chave de segredo é no-op; grava blob quando `SECRET_KEYS.has(key)`.
    - `unset(key: string): Promise<void>`
    - `describe(): Promise<Record<string, string | boolean>>` — valores não-segredos crus; para segredos, `"<key>Set"` booleano (nunca o valor).
  - `SettingsModule` (global) exporta `SettingsService`.

- [ ] **Step 1: Adicionar o model e migrar**

Editar `backend/prisma/schema.prisma`, ao lado dos outros models:

```prisma
model Setting {
  key       String   @id
  value     String
  encrypted Boolean  @default(false)
  updatedAt DateTime @updatedAt

  @@map("settings")
}
```

Run:
```bash
cd backend && npx prisma migrate dev --name settings && npx prisma generate
```
Expected: cria `backend/prisma/migrations/<ts>_settings/` e regenera o client.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// backend/src/settings/settings.service.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from './settings.service.js';

const KEY = Buffer.alloc(32, 3).toString('base64');

function makePrisma(rows: Record<string, { value: string; encrypted: boolean }> = {}) {
  const store = new Map(Object.entries(rows));
  return {
    setting: {
      findMany: vi.fn(async () =>
        [...store].map(([key, v]) => ({ key, ...v, updatedAt: new Date() })),
      ),
      findUnique: vi.fn(async ({ where: { key } }: any) =>
        store.has(key) ? { key, ...store.get(key)!, updatedAt: new Date() } : null,
      ),
      upsert: vi.fn(async ({ where: { key }, create, update }: any) => {
        store.set(key, { value: (create ?? update).value, encrypted: !!(create ?? update).encrypted });
      }),
      delete: vi.fn(async ({ where: { key } }: any) => void store.delete(key)),
    },
    __store: store,
  };
}

describe('SettingsService', () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.MAIL_FROM;
  });

  it('get cai pro env legado quando a chave não está no banco', async () => {
    process.env.MAIL_FROM = 'suporte@x.com';
    const svc = new SettingsService(makePrisma() as any);
    expect(await svc.get('mail.from')).toBe('suporte@x.com');
  });

  it('valor do banco tem precedência sobre o env legado', async () => {
    process.env.MAIL_FROM = 'env@x.com';
    const svc = new SettingsService(makePrisma({ 'mail.from': { value: 'db@x.com', encrypted: false } }) as any);
    expect(await svc.get('mail.from')).toBe('db@x.com');
  });

  it('set de segredo grava blob criptografado; get descriptografa', async () => {
    const prisma = makePrisma();
    const svc = new SettingsService(prisma as any);
    await svc.set('resend.apiKey', 'rk_live_x');
    expect(prisma.__store.get('resend.apiKey')!.encrypted).toBe(true);
    expect(prisma.__store.get('resend.apiKey')!.value.startsWith('v1:')).toBe(true);
    expect(await svc.get('resend.apiKey')).toBe('rk_live_x');
  });

  it('set de segredo com string vazia é no-op (não apaga o que já existe)', async () => {
    const prisma = makePrisma();
    const svc = new SettingsService(prisma as any);
    await svc.set('resend.apiKey', 'rk_1');
    await svc.set('resend.apiKey', '');
    expect(await svc.get('resend.apiKey')).toBe('rk_1');
  });

  it('cache invalida no set (segundo get reflete o novo valor sem novo findMany dobrado)', async () => {
    const prisma = makePrisma({ 'branding.companyName': { value: 'Antiga', encrypted: false } });
    const svc = new SettingsService(prisma as any);
    expect(await svc.get('branding.companyName')).toBe('Antiga');
    await svc.set('branding.companyName', 'Nova');
    expect(await svc.get('branding.companyName')).toBe('Nova');
  });

  it('describe nunca devolve valor de segredo, só o booleano <key>Set', async () => {
    const svc = new SettingsService(
      makePrisma({
        'resend.apiKey': { value: 'v1:a:b:c', encrypted: true },
        'branding.companyName': { value: 'One Day', encrypted: false },
      }) as any,
    );
    const view = await svc.describe();
    expect(view['branding.companyName']).toBe('One Day');
    expect(view['resend.apiKeySet']).toBe(true);
    expect(view['resend.apiKey']).toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/settings/settings.service.spec.ts`
Expected: FAIL — `settings.service.js`/`settings.keys.js` não existem.

- [ ] **Step 4: Implementar o catálogo**

```ts
// backend/src/settings/settings.keys.ts
export const SETTING_KEYS = [
  'resend.apiKey',
  'mail.from',
  'resend.inboundSecret',
  'storage.driver',
  'storage.path',
  'storage.s3.endpoint',
  'storage.s3.region',
  'storage.s3.bucket',
  'storage.s3.accessKeyId',
  'storage.s3.secretAccessKey',
  'storage.s3.forcePathStyle',
  'storage.s3.publicBaseUrl',
  'storage.s3.prefix',
  'backup.s3.enabled',
  'backup.retention',
  'branding.companyName',
  'branding.primaryColor',
  'branding.logoData',
  'branding.logoMime',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'resend.apiKey',
  'resend.inboundSecret',
  'storage.s3.accessKeyId',
  'storage.s3.secretAccessKey',
]);

/** Chave de config -> variável de ambiente legada (fallback durante a transição). */
export const ENV_FALLBACK: Readonly<Record<string, string>> = {
  'resend.apiKey': 'RESEND_API_KEY',
  'mail.from': 'MAIL_FROM',
  'resend.inboundSecret': 'RESEND_INBOUND_SECRET',
  'storage.path': 'STORAGE_PATH',
};

/** Chaves grandes que `describe()` nunca deve devolver cruas por peso (logo). */
export const BULKY_KEYS: ReadonlySet<string> = new Set(['branding.logoData']);
```

- [ ] **Step 5: Implementar o service**

```ts
// backend/src/settings/settings.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, encrypt } from './crypto.util.js';
import { BULKY_KEYS, ENV_FALLBACK, SECRET_KEYS } from './settings.keys.js';

interface Row {
  value: string;
  encrypted: boolean;
}

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private cache: Map<string, Row> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<Map<string, Row>> {
    if (this.cache) return this.cache;
    const rows = await this.prisma.setting.findMany();
    this.cache = new Map(rows.map((r) => [r.key, { value: r.value, encrypted: r.encrypted }]));
    return this.cache;
  }

  private invalidate(): void {
    this.cache = null;
  }

  async get(key: string): Promise<string | undefined> {
    const row = (await this.load()).get(key);
    if (row) {
      if (!row.encrypted) return row.value;
      try {
        return decrypt(row.value);
      } catch (err) {
        // Chave errada/ausente: não derruba o boot — cai pro fallback abaixo.
        this.logger.error(`Falha ao descriptografar "${key}": ${(err as Error).message}`);
      }
    }
    const env = ENV_FALLBACK[key];
    return env ? process.env[env] : undefined;
  }

  async getMany(keys: string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) out[k] = await this.get(k);
    return out;
  }

  async getBool(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  async getNumber(key: string): Promise<number | undefined> {
    const v = await this.get(key);
    if (v == null || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  async set(key: string, value: string, opts: { encrypt?: boolean } = {}): Promise<void> {
    const isSecret = SECRET_KEYS.has(key) || opts.encrypt === true;
    if (isSecret && value === '') return; // no-op: não apaga segredo existente
    const stored = isSecret ? encrypt(value) : value;
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: stored, encrypted: isSecret },
      update: { value: stored, encrypted: isSecret },
    });
    this.invalidate();
  }

  async unset(key: string): Promise<void> {
    await this.prisma.setting.delete({ where: { key } }).catch(() => undefined);
    this.invalidate();
  }

  /** Visão para a UI: valores não-segredos crus; segredos viram `<key>Set: boolean`. */
  async describe(): Promise<Record<string, string | boolean>> {
    const cache = await this.load();
    const out: Record<string, string | boolean> = {};
    for (const [key, row] of cache) {
      if (SECRET_KEYS.has(key)) {
        out[`${key}Set`] = row.value !== '';
      } else if (BULKY_KEYS.has(key)) {
        out[`${key}Set`] = row.value !== '';
      } else {
        out[key] = row.value;
      }
    }
    // segredos sem linha no banco: reporta se há fallback de env
    for (const key of SECRET_KEYS) {
      if (!(key in cache) && out[`${key}Set`] === undefined) {
        const env = ENV_FALLBACK[key];
        out[`${key}Set`] = !!(env && process.env[env]);
      }
    }
    return out;
  }
}
```

- [ ] **Step 6: Módulo + registro**

```ts
// backend/src/settings/settings.module.ts
import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
```

Em `backend/src/app.module.ts`: adicionar `import { SettingsModule } from './settings/settings.module.js';` e incluir `SettingsModule` no array `imports` (logo após `PrismaModule`).

- [ ] **Step 7: Rodar e ver passar**

Run: `cd backend && npx vitest run src/settings/settings.service.spec.ts`
Expected: PASS (6 testes).

- [ ] **Step 8: Suite completa**

Run: `cd backend && npm test`
Expected: tudo verde (nenhuma regressão).

- [ ] **Step 9: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations backend/src/settings backend/src/app.module.ts
git commit -m "feat(settings): SettingsService com store no banco, cache e fallback pro env"
```

---

## Task 3: `SettingsController` — `GET`/`PUT /settings`

**Files:**
- Create: `backend/src/settings/dto/update-settings.dto.ts`
- Create: `backend/src/settings/settings.controller.ts`
- Create: `backend/src/settings/settings.controller.spec.ts`
- Modify: `backend/src/settings/settings.module.ts` (registrar o controller)

**Interfaces:**
- Consumes: `SettingsService` (Task 2).
- Produces:
  - `GET /api/settings` → objeto de `SettingsService.describe()` + `{ encryptionKeySet: boolean }`.
  - `PUT /api/settings` body `{ values: Record<string, string> }` — só chaves em `SETTING_KEYS`; grava cada uma via `set`. Retorna `describe()` atualizado.
  - `class UpdateSettingsDto { values: Record<string, string> }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/settings/settings.controller.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';

function makeSvc() {
  return {
    describe: vi.fn(async () => ({ 'branding.companyName': 'One Day', 'resend.apiKeySet': true })),
    set: vi.fn(async () => undefined),
  };
}

describe('SettingsController', () => {
  it('GET devolve describe() + encryptionKeySet', async () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const svc = makeSvc();
    const c = new SettingsController(svc as any);
    const res = await c.get();
    expect(res['branding.companyName']).toBe('One Day');
    expect(res.encryptionKeySet).toBe(true);
  });

  it('PUT grava só chaves conhecidas e rejeita chave desconhecida', async () => {
    const svc = makeSvc();
    const c = new SettingsController(svc as any);
    await c.update({ values: { 'branding.companyName': 'Nova', 'mail.from': 'a@b.com' } });
    expect(svc.set).toHaveBeenCalledWith('branding.companyName', 'Nova');
    expect(svc.set).toHaveBeenCalledWith('mail.from', 'a@b.com');

    await expect(c.update({ values: { 'chave.fantasma': 'x' } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/settings/settings.controller.spec.ts`
Expected: FAIL — controller não existe.

- [ ] **Step 3: Implementar o DTO**

```ts
// backend/src/settings/dto/update-settings.dto.ts
import { IsObject } from 'class-validator';

export class UpdateSettingsDto {
  @IsObject()
  values!: Record<string, string>;
}
```

- [ ] **Step 4: Implementar o controller**

```ts
// backend/src/settings/settings.controller.ts
import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { isEncryptionKeySet } from './crypto.util.js';
import { SETTING_KEYS } from './settings.keys.js';
import { SettingsService } from './settings.service.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

const KNOWN = new Set<string>(SETTING_KEYS);

@Controller('settings')
@Roles('ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get() {
    return { ...(await this.settings.describe()), encryptionKeySet: isEncryptionKeySet() };
  }

  @Put()
  async update(@Body() dto: UpdateSettingsDto) {
    const entries = Object.entries(dto.values ?? {});
    for (const [key] of entries) {
      if (!KNOWN.has(key)) throw new BadRequestException(`Configuração desconhecida: ${key}.`);
    }
    for (const [key, value] of entries) {
      await this.settings.set(key, String(value ?? ''));
    }
    return { ...(await this.settings.describe()), encryptionKeySet: isEncryptionKeySet() };
  }
}
```

- [ ] **Step 5: Registrar no módulo**

Em `settings.module.ts`: `controllers: [SettingsController]`.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && npx vitest run src/settings/settings.controller.spec.ts && npm test`
Expected: PASS; suite verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/settings
git commit -m "feat(settings): endpoints GET/PUT /settings (ADMIN)"
```

---

## Task 4: `StorageService` + `DiskStorageDriver` + refactor do `AttachmentsService`

**Files:**
- Create: `backend/src/storage/storage.types.ts`
- Create: `backend/src/storage/disk.driver.ts`
- Create: `backend/src/storage/storage.service.ts`
- Create: `backend/src/storage/storage.module.ts`
- Create: `backend/src/storage/storage.service.spec.ts`
- Modify: `backend/src/attachments/attachments.service.ts`
- Modify: `backend/src/attachments/attachments.controller.ts`
- Modify: `backend/src/attachments/attachments.module.ts`
- Modify: `backend/src/attachments/attachments.service.spec.ts` (ajustar mocks)

**Interfaces:**
- Consumes: `SettingsService` (`storage.driver`, `storage.path`).
- Produces:
  - `storage.types.ts`:
    ```ts
    export interface StoredObject { stream: Readable; mime?: string; size?: number; }
    export interface StorageDriver {
      put(key: string, body: Buffer, mime: string): Promise<void>;
      readable(key: string): Promise<StoredObject>;
      remove(key: string): Promise<void>;
      exists(key: string): Promise<boolean>;
      list(prefix: string): Promise<string[]>;
    }
    ```
  - `class StorageService`:
    - `put(key, body, mime)`, `readable(key)`, `remove(key)`, `exists(key)`, `list(prefix)` — delegam ao driver ativo.
    - `readable(key)` faz **dual-read**: se `isLegacyDiskPath(key)` OU o arquivo existe no disco, lê via `DiskStorageDriver`; senão via driver ativo.
    - `activeDriver(): Promise<'disk' | 's3'>` (default `'disk'`).
    - `testConnection(): Promise<void>` — `put('__probe/<uuid>', ...)` + `remove`.
  - `isLegacyDiskPath(key: string): boolean` — `true` se começa com `/`, `\\`, ou casa `^[A-Za-z]:[\\/]`.
  - `StorageModule` (global) exporta `StorageService`.
- Semântica nova de `Attachment.storedPath`: para linhas criadas a partir daqui, é a **key** `attachments/<uuid><ext>` (não caminho absoluto). Linhas antigas seguem com caminho absoluto e são resolvidas pelo dual-read.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/storage/storage.service.spec.ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService, isLegacyDiskPath } from './storage.service.js';

function settingsStub(overrides: Record<string, string> = {}) {
  const map: Record<string, string> = { 'storage.driver': 'disk', ...overrides };
  return { get: vi.fn(async (k: string) => map[k]), getBool: vi.fn(async () => false) };
}

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

describe('isLegacyDiskPath', () => {
  it.each(['/var/uploads/x.png', 'C:\\uploads\\x.png', '\\\\srv\\share\\x'])('%s -> true', (p) => {
    expect(isLegacyDiskPath(p)).toBe(true);
  });
  it('key relativa -> false', () => {
    expect(isLegacyDiskPath('attachments/abc.png')).toBe(false);
  });
});

describe('StorageService (driver disk)', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'os-storage-'));
    process.env.STORAGE_PATH = base;
  });

  it('put grava e readable devolve os mesmos bytes', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('attachments/a.txt', Buffer.from('ola'), 'text/plain');
    const obj = await svc.readable('attachments/a.txt');
    expect((await drain(obj.stream)).toString()).toBe('ola');
  });

  it('dual-read: caminho absoluto legado é lido direto do disco', async () => {
    const legacy = join(base, 'legado.txt');
    await writeFile(legacy, 'antigo');
    const svc = new StorageService(settingsStub({ 'storage.driver': 's3' }) as any);
    const obj = await svc.readable(legacy);
    expect((await drain(obj.stream)).toString()).toBe('antigo');
  });

  it('remove apaga o objeto', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('attachments/b.txt', Buffer.from('x'), 'text/plain');
    await svc.remove('attachments/b.txt');
    expect(await svc.exists('attachments/b.txt')).toBe(false);
  });

  it('list devolve as keys sob o prefixo', async () => {
    const svc = new StorageService(settingsStub() as any);
    await svc.put('backups/1.json', Buffer.from('{}'), 'application/json');
    await svc.put('backups/2.json', Buffer.from('{}'), 'application/json');
    expect((await svc.list('backups/')).sort()).toEqual(['backups/1.json', 'backups/2.json']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/storage/storage.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar tipos + disk driver**

```ts
// backend/src/storage/storage.types.ts
import type { Readable } from 'node:stream';

export interface StoredObject {
  stream: Readable;
  mime?: string;
  size?: number;
}

export interface StorageDriver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  readable(key: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
```

```ts
// backend/src/storage/disk.driver.ts
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { StorageDriver, StoredObject } from './storage.types.js';

/** Driver de disco. `key` relativa fica sob `STORAGE_PATH`; caminho absoluto é usado como está. */
export class DiskStorageDriver implements StorageDriver {
  private base(): string {
    return resolve(process.env.STORAGE_PATH ?? './uploads');
  }

  private full(key: string): string {
    return isAbsolute(key) ? key : join(this.base(), key);
  }

  async put(key: string, body: Buffer, _mime: string): Promise<void> {
    const path = this.full(key);
    await mkdir(dirname(path), { recursive: true });
    await (await import('node:fs/promises')).writeFile(path, body);
  }

  async readable(key: string): Promise<StoredObject> {
    const path = this.full(key);
    const s = await stat(path);
    return { stream: createReadStream(path), size: s.size };
  }

  async remove(key: string): Promise<void> {
    await rm(this.full(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.full(key)).then(
      () => true,
      () => false,
    );
  }

  async list(prefix: string): Promise<string[]> {
    const root = join(this.base(), prefix);
    const dir = await readdir(root, { withFileTypes: true }).catch(() => []);
    return dir
      .filter((d) => d.isFile())
      .map((d) => `${prefix}${d.name}`.split(sep).join('/'));
  }
}
```

- [ ] **Step 4: Implementar o service**

```ts
// backend/src/storage/storage.service.ts
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import { DiskStorageDriver } from './disk.driver.js';
import { S3StorageDriver } from './s3.driver.js';
import type { StorageDriver, StoredObject } from './storage.types.js';

/** `true` para caminhos absolutos POSIX/UNC/Windows (linhas antigas de Attachment). */
export function isLegacyDiskPath(key: string): boolean {
  return key.startsWith('/') || key.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(key);
}

@Injectable()
export class StorageService {
  private readonly disk = new DiskStorageDriver();

  constructor(private readonly settings: SettingsService) {}

  async activeDriver(): Promise<'disk' | 's3'> {
    return (await this.settings.get('storage.driver')) === 's3' ? 's3' : 'disk';
  }

  private async driver(): Promise<StorageDriver> {
    if ((await this.activeDriver()) === 's3') {
      return S3StorageDriver.fromSettings(this.settings);
    }
    return this.disk;
  }

  put(key: string, body: Buffer, mime: string): Promise<void> {
    return this.driver().then((d) => d.put(key, body, mime));
  }

  async readable(key: string): Promise<StoredObject> {
    // Dual-read: caminho absoluto legado, ou objeto que ainda mora no disco.
    if (isLegacyDiskPath(key) || (await this.disk.exists(key))) {
      return this.disk.readable(key);
    }
    return (await this.driver()).readable(key);
  }

  remove(key: string): Promise<void> {
    return this.driver().then((d) => d.remove(key));
  }

  exists(key: string): Promise<boolean> {
    return this.driver().then((d) => d.exists(key));
  }

  list(prefix: string): Promise<string[]> {
    return this.driver().then((d) => d.list(prefix));
  }

  /** Sonda de escrita/leitura/remoção — usado pelo "Testar conexão" da UI. */
  async testConnection(): Promise<void> {
    const key = `__probe/${randomUUID()}`;
    const d = await this.driver();
    await d.put(key, Buffer.from('probe'), 'text/plain');
    await d.remove(key);
  }
}
```

> Nota: `s3.driver.ts` é criado na Task 5. Para esta task compilar, criar o arquivo já com um stub que lança:
> ```ts
> // backend/src/storage/s3.driver.ts  (stub — implementado na Task 5)
> import type { SettingsService } from '../settings/settings.service.js';
> import type { StorageDriver, StoredObject } from './storage.types.js';
> export class S3StorageDriver implements StorageDriver {
>   static fromSettings(_s: SettingsService): S3StorageDriver {
>     throw new Error('Driver S3 ainda não configurado.');
>   }
>   put(): Promise<void> { throw new Error('n/i'); }
>   readable(): Promise<StoredObject> { throw new Error('n/i'); }
>   remove(): Promise<void> { throw new Error('n/i'); }
>   exists(): Promise<boolean> { throw new Error('n/i'); }
>   list(): Promise<string[]> { throw new Error('n/i'); }
> }
> ```

- [ ] **Step 5: Módulo**

```ts
// backend/src/storage/storage.module.ts
import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
```

Registrar `StorageModule` em `app.module.ts` (após `SettingsModule`).

- [ ] **Step 6: Rodar o teste do storage**

Run: `cd backend && npx vitest run src/storage/storage.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Refatorar `AttachmentsService` para usar o storage**

Em `backend/src/attachments/attachments.service.ts`:
- Injetar `StorageService` no construtor: `constructor(private readonly prisma: PrismaService, private readonly tickets: TicketsService, private readonly storage: StorageService) {}`.
- `onModuleInit`: só `mkdir` quando driver disk:
  ```ts
  async onModuleInit(): Promise<void> {
    if ((await this.storage.activeDriver()) === 'disk') {
      await mkdir(storagePath(), { recursive: true });
    }
  }
  ```
- Em `persist`, trocar a escrita direta por key + storage:
  ```ts
  const key = `attachments/${storedName(file.originalname)}`;
  await this.storage.put(key, file.buffer, file.mimetype);
  return this.prisma.attachment.create({
    data: {
      ...link,
      filename: file.originalname,
      storedPath: key,
      mime: file.mimetype,
      size: file.size,
      uploadedById: actor?.id as string,
    },
  });
  ```
  (remover o `import { writeFile }` e o `join(storagePath(), ...)` da escrita; manter `storagePath()` só para o `onModuleInit`.)

Em `backend/src/attachments/attachments.controller.ts`, método `download`: trocar `res.download(...)` por stream do storage + `Content-Disposition` manual:
```ts
import { pipeline } from 'node:stream/promises';
// ...
@Get('attachments/:id')
async download(
  @Param('id') id: string,
  @CurrentUser() actor: CurrentUserData,
  @Res() res: Response,
) {
  const attachment = await this.attachments.getForDownload(id, actor);
  let obj;
  try {
    obj = await this.attachments.readable(attachment.storedPath);
  } catch {
    throw new NotFoundException('Arquivo não encontrado no armazenamento.');
  }
  res.type(attachment.mime);
  // RFC 5987: nome ASCII + filename* em UTF-8 percent-encoded.
  const ascii = attachment.filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
  );
  await pipeline(obj.stream, res);
}
```
Adicionar em `AttachmentsService` um passa-through:
```ts
readable(storedPath: string) {
  return this.storage.readable(storedPath);
}
```
Importe `NotFoundException` no controller se ainda não estiver.

Em `backend/src/attachments/attachments.module.ts`: garantir que `StorageModule` está acessível (é `@Global`, então basta estar registrado no `app.module.ts`; não precisa importar de novo).

- [ ] **Step 8: Ajustar o spec de attachments**

Em `attachments.service.spec.ts`, onde hoje se testa a escrita em disco: injetar um `storage` fake `{ put: vi.fn(), readable: vi.fn(), activeDriver: vi.fn().mockResolvedValue('disk') }` no construtor e asserir `storage.put` chamado com key `attachments/…` e `storedPath` salvo = essa key. Manter as asserções de validação (mime/size) intactas.

- [ ] **Step 9: Suite completa**

Run: `cd backend && npm test`
Expected: verde. Rodar também integração de anexos se existir:
Run: `cd backend && npm run test:integration` (exige Postgres; se indisponível no ambiente do executor, registrar no ledger e seguir).

- [ ] **Step 10: Commit**

```bash
git add backend/src/storage backend/src/attachments backend/src/app.module.ts
git commit -m "feat(storage): StorageService com driver disk e dual-read; anexos passam pelo storage"
```

---

## Task 5: `S3StorageDriver` + dependência `@aws-sdk/client-s3` + "testar conexão"

**Files:**
- Modify: `backend/package.json` (dep `@aws-sdk/client-s3`)
- Replace: `backend/src/storage/s3.driver.ts` (stub → implementação real)
- Create: `backend/src/storage/s3.driver.spec.ts`
- Modify: `backend/src/settings/settings.controller.ts` (+ `POST /settings/storage/test`)
- Modify: `backend/src/settings/settings.module.ts` (já tem o controller; garantir `StorageService` injetável — é global)
- Modify: `backend/src/settings/settings.controller.spec.ts` (+ caso do teste de conexão)

**Interfaces:**
- Consumes: `SettingsService` keys `storage.s3.*`; `StorageService.testConnection()`.
- Produces:
  - `S3StorageDriver.fromSettings(settings: SettingsService): Promise<S3StorageDriver>` — lê `endpoint`, `region`, `bucket`, `accessKeyId`, `secretAccessKey`, `forcePathStyle` (`'true'`), `prefix`. Lança `BadRequestException` se `bucket`/credenciais faltarem.
  - Implementa `StorageDriver`. Key real = `${prefix}${key}`.
  - `POST /api/settings/storage/test` → `{ ok: true }` ou `502` com a mensagem do SDK.
- **Ajuste em `storage.service.ts`:** `S3StorageDriver.fromSettings` agora é `async` → `return await S3StorageDriver.fromSettings(this.settings)`.

- [ ] **Step 1: Instalar a dependência**

Run:
```bash
cd backend && npm install @aws-sdk/client-s3@^3
```
Expected: `@aws-sdk/client-s3` em `dependencies` do `backend/package.json`.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// backend/src/storage/s3.driver.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = send;
  }
  class PutObjectCommand {
    constructor(public input: any) {}
  }
  class GetObjectCommand {
    constructor(public input: any) {}
  }
  class DeleteObjectCommand {
    constructor(public input: any) {}
  }
  class ListObjectsV2Command {
    constructor(public input: any) {}
  }
  class HeadObjectCommand {
    constructor(public input: any) {}
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
  };
});

import { S3StorageDriver } from './s3.driver.js';

function settings(map: Record<string, string>) {
  return { get: vi.fn(async (k: string) => map[k]) };
}
const base = {
  'storage.s3.region': 'auto',
  'storage.s3.bucket': 'meu-bucket',
  'storage.s3.accessKeyId': 'AK',
  'storage.s3.secretAccessKey': 'SK',
  'storage.s3.prefix': 'os/',
};

describe('S3StorageDriver', () => {
  beforeEach(() => send.mockReset());

  it('fromSettings sem bucket lança', async () => {
    await expect(S3StorageDriver.fromSettings(settings({}) as any)).rejects.toThrow();
  });

  it('put manda PutObjectCommand com Key prefixada', async () => {
    send.mockResolvedValue({});
    const d = await S3StorageDriver.fromSettings(settings(base) as any);
    await d.put('attachments/x.png', Buffer.from('x'), 'image/png');
    const cmd = send.mock.calls[0][0];
    expect(cmd.input.Bucket).toBe('meu-bucket');
    expect(cmd.input.Key).toBe('os/attachments/x.png');
    expect(cmd.input.ContentType).toBe('image/png');
  });

  it('list devolve keys sem o prefixo', async () => {
    send.mockResolvedValue({ Contents: [{ Key: 'os/backups/1.json' }, { Key: 'os/backups/2.json' }] });
    const d = await S3StorageDriver.fromSettings(settings(base) as any);
    expect(await d.list('backups/')).toEqual(['backups/1.json', 'backups/2.json']);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/storage/s3.driver.spec.ts`
Expected: FAIL — stub lança "n/i".

- [ ] **Step 4: Implementar o driver**

```ts
// backend/src/storage/s3.driver.ts
import type { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { SettingsService } from '../settings/settings.service.js';
import type { StorageDriver, StoredObject } from './storage.types.js';

export class S3StorageDriver implements StorageDriver {
  private constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  static async fromSettings(settings: SettingsService): Promise<S3StorageDriver> {
    const [endpoint, region, bucket, accessKeyId, secretAccessKey, forcePathStyle, prefix] =
      await Promise.all([
        settings.get('storage.s3.endpoint'),
        settings.get('storage.s3.region'),
        settings.get('storage.s3.bucket'),
        settings.get('storage.s3.accessKeyId'),
        settings.get('storage.s3.secretAccessKey'),
        settings.get('storage.s3.forcePathStyle'),
        settings.get('storage.s3.prefix'),
      ]);
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new BadRequestException('Configure bucket, access key e secret key do S3.');
    }
    const client = new S3Client({
      region: region || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: forcePathStyle === 'true',
      credentials: { accessKeyId, secretAccessKey },
    });
    return new S3StorageDriver(client, bucket, prefix ?? '');
  }

  private k(key: string): string {
    return `${this.prefix}${key}`;
  }

  async put(key: string, body: Buffer, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: body, ContentType: mime }),
    );
  }

  async readable(key: string): Promise<StoredObject> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }),
    );
    return {
      stream: res.Body as Readable,
      mime: res.ContentType,
      size: res.ContentLength,
    };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const res = await this.client.send(
      new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.k(prefix) }),
    );
    return (res.Contents ?? [])
      .map((o) => o.Key ?? '')
      .filter(Boolean)
      .map((k) => k.slice(this.prefix.length));
  }
}
```

- [ ] **Step 5: Ajustar `storage.service.ts`**

Trocar `return S3StorageDriver.fromSettings(this.settings);` por `return await S3StorageDriver.fromSettings(this.settings);` dentro de `driver()`.

- [ ] **Step 6: Adicionar `POST /settings/storage/test`**

Em `settings.controller.ts`:
```ts
import { HttpException, HttpStatus, Post } from '@nestjs/common';
import { StorageService } from '../storage/storage.service.js';
// injetar no construtor: private readonly storage: StorageService

@Post('storage/test')
async testStorage() {
  try {
    await this.storage.testConnection();
    return { ok: true };
  } catch (err) {
    throw new HttpException(
      `Falha ao acessar o armazenamento: ${(err as Error).message}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
```
Atualizar `settings.controller.spec.ts`: adicionar `storage: { testConnection: vi.fn() }` ao construtor nos testes existentes + um caso novo (`testConnection` rejeita → `HttpException` 502).

- [ ] **Step 7: Rodar tudo**

Run: `cd backend && npx vitest run src/storage src/settings && npm test`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/storage backend/src/settings
git commit -m "feat(storage): driver S3 (aws-sdk) e POST /settings/storage/test"
```

---

## Task 6: `EmailService`, templates e `InboundController` lendo do `SettingsService`

**Files:**
- Modify: `backend/src/email/email.module.ts` (importar `SettingsModule` — é global, então só garantir injeção)
- Modify: `backend/src/email/email.service.ts`
- Modify: `backend/src/email/templates.ts`
- Modify: `backend/src/email/email.service.spec.ts`
- Modify: `backend/src/inbound/inbound.controller.ts`
- Modify: `backend/src/inbound/inbound.controller.spec.ts`

**Interfaces:**
- Consumes: `SettingsService.getMany(['resend.apiKey','mail.from','branding.companyName'])`, `SettingsService.getBool` não; `SettingsService.get('branding.logoData')` para saber se há logo.
- Produces:
  - `EmailService.send(...)` inalterado na assinatura; passa a ler `apiKey`/`from` do `SettingsService` (fallback env preservado pelo próprio service).
  - `templates.ts`: cada função de template continua `(...) => RenderedEmail`, mas `wrap(title, body)` vira `wrap(title, body, brand?)` com `brand?: { companyName?: string; logoUrl?: string }`. `EmailService` injeta `brand` ao renderizar.
  - `verifyResendSignature(rawBody, signature, secret)` — ganha 3º parâmetro `secret: string` (não lê mais `process.env`). O controller busca o secret via `SettingsService`.

- [ ] **Step 1: Ajustar os testes (falham primeiro)**

`email.service.spec.ts`:
- Remover os `process.env.RESEND_API_KEY = ...`; em vez disso construir `new EmailService(settingsStub)` onde `settingsStub = { getMany: vi.fn().mockResolvedValue({ 'resend.apiKey': 'rk_test', 'mail.from': 'suporte@exemplo.com.br', 'branding.companyName': undefined }), get: vi.fn().mockResolvedValue(undefined) }`.
- Caso "sem RESEND_API_KEY": `getMany` resolve `{ 'resend.apiKey': undefined, 'mail.from': 'suporte@exemplo.com.br' }` → espera warn e nenhum `sendMock`.
- Novo caso: "banco tem a chave, env não" — `delete process.env.RESEND_API_KEY`, `getMany` resolve com a chave → `sendMock` chamado.

`inbound.controller.spec.ts`:
- `verifyResendSignature(raw, sig)` → `verifyResendSignature(raw, sig, 'segredo')`. Ajustar as chamadas e remover `process.env.RESEND_INBOUND_SECRET`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/email src/inbound`
Expected: FAIL (assinaturas mudaram).

- [ ] **Step 3: Implementar `email.service.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { SettingsService } from '../settings/settings.service.js';

@Injectable()
export class EmailService {
  private readonly logger = new Logger('EmailService');
  private client?: Resend;
  private clientKey?: string;

  constructor(private readonly settings: SettingsService) {}

  async send({ to, subject, html, headers, replyTo }: SendEmailInput): Promise<void> {
    const cfg = await this.settings.getMany(['resend.apiKey', 'mail.from']);
    const apiKey = cfg['resend.apiKey'];
    const from = cfg['mail.from'] ?? '';

    if (!apiKey) {
      this.logger.warn(`[email] RESEND_API_KEY ausente — e-mail não enviado: ${subject} -> ${to}`);
      return;
    }
    try {
      if (!this.client || this.clientKey !== apiKey) {
        this.client = new Resend(apiKey);
        this.clientKey = apiKey;
      }
      const { error } = await this.client.emails.send({
        from,
        to,
        subject,
        html,
        replyTo: replyTo ?? from,
        headers,
      });
      if (error) {
        this.logger.error(`[email] Resend recusou "${subject}" -> ${to}: ${error.message}`);
      }
    } catch (err) {
      this.logger.error(`[email] falha ao enviar "${subject}" -> ${to}: ${(err as Error).message}`);
    }
  }

  /** Marca (nome + URL do logo) para os templates. `logoUrl` só quando há logo salvo. */
  async brand(): Promise<{ companyName?: string; logoUrl?: string }> {
    const [companyName, logo] = await Promise.all([
      this.settings.get('branding.companyName'),
      this.settings.get('branding.logoData'),
    ]);
    const appUrl = process.env.APP_URL ?? '';
    return { companyName, logoUrl: logo && appUrl ? `${appUrl}/api/branding/logo` : undefined };
  }
}
```

> `ResendMailSender` (mesmo arquivo/pasta) chama `this.email.send(...)`; nada muda lá. Onde os templates são renderizados hoje (ex.: `notifications` service), passar `await this.email.brand()` como 3º arg de `wrap` via as funções de template — ver Step 4.

- [ ] **Step 4: `templates.ts` — logo + rodapé**

```ts
const wrap = (
  title: string,
  body: string,
  brand: { companyName?: string; logoUrl?: string } = {},
): string => {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" style="max-height:40px;margin-bottom:12px">`
    : '';
  const footer = brand.companyName
    ? `<hr style="border:none;border-top:1px solid #eee;margin:20px 0 8px">` +
      `<p style="font-size:12px;color:#888">${escapeHtml(brand.companyName)}</p>`
    : '';
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5">` +
    `${logo}<h2 style="font-size:16px;margin:0 0 12px">${title}</h2>${body}${footer}</div>`
  );
};
```

Cada função exportada (`ticketCreated`, `ticketComment`, …) ganha um parâmetro opcional `brand` no fim e o repassa a `wrap(...)`. Ex.:
```ts
export function ticketCreated(ticket: Ticket, brand?: BrandInfo): RenderedEmail {
  return {
    subject: `${ticketRef(ticket)} ${ticket.title}`,
    html: wrap('Chamado aberto', `...`, brand),
  };
}
```
`export interface BrandInfo { companyName?: string; logoUrl?: string }`.

No serviço que dispara e-mails (procurar chamadas a `contactInvite`, `ticketCreated` etc. — provavelmente `notifications/*.ts` e `users/users.service.ts` via `ResendMailSender`): antes de renderizar, obter `const brand = await this.email.brand();` e passar como último argumento. Onde a renderização é feita dentro do `ResendMailSender.sendInvite`, mudar para:
```ts
async sendInvite(user: { name: string; email: string }, link: string): Promise<void> {
  await this.email.send({ to: user.email, ...contactInvite(user, link, await this.email.brand()) });
}
```

- [ ] **Step 5: `inbound.controller.ts` — secret via settings**

```ts
export function verifyResendSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !signature) return false;
  const expected = createHmac('sha256', secret ?? '').update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
```
No handler `receive(...)`: injetar `SettingsService` no construtor do controller e, dentro do handler:
```ts
const secret = (await this.settings.get('resend.inboundSecret')) ?? '';
if (!verifyResendSignature(req.rawBody, signature, secret)) {
  throw new UnauthorizedException('Assinatura inválida.');
}
```
(Manter o `@Public()` do controller.)

- [ ] **Step 6: Rodar e ver passar**

Run: `cd backend && npx vitest run src/email src/inbound && npm test`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add backend/src/email backend/src/inbound
git commit -m "feat(settings): Resend e webhook inbound leem config do banco com fallback pro env"
```

---

## Task 7: `BrandingController` público + upload/remoção de logo

**Files:**
- Create: `backend/src/branding/branding.controller.ts`
- Create: `backend/src/branding/branding.module.ts`
- Create: `backend/src/branding/branding.controller.spec.ts`
- Modify: `backend/src/settings/settings.controller.ts` (+ `POST`/`DELETE /settings/branding/logo`)
- Modify: `backend/src/app.module.ts` (importar `BrandingModule`)

**Interfaces:**
- Consumes: `SettingsService` (`branding.companyName`, `branding.primaryColor`, `branding.logoData`, `branding.logoMime`).
- Produces:
  - `GET /api/branding` → `{ companyName: string | null, primaryColor: string | null, hasLogo: boolean, logoUrl: '/api/branding/logo' }` (`@Public`).
  - `GET /api/branding/logo` → bytes do logo com `Content-Type` = `branding.logoMime`, `Cache-Control: public, max-age=300`; `404` se não houver (`@Public`).
  - `POST /api/settings/branding/logo` (ADMIN, `FileInterceptor('file')`) — valida mime `image/(png|jpe?g|webp|svg\+xml)` e tamanho ≤ 512 KB; grava `branding.logoData` (base64) + `branding.logoMime`. Retorna `{ ok: true }`.
  - `DELETE /api/settings/branding/logo` (ADMIN) — `unset` das duas chaves.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/branding/branding.controller.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';

function svc(map: Record<string, string | undefined>) {
  return { get: vi.fn(async (k: string) => map[k]) };
}

describe('BrandingController', () => {
  it('GET /branding reflete nome, cor e hasLogo', async () => {
    const c = new BrandingController(
      svc({ 'branding.companyName': 'One Day', 'branding.primaryColor': '#0a0', 'branding.logoData': 'AAAA' }) as any,
    );
    expect(await c.info()).toEqual({
      companyName: 'One Day',
      primaryColor: '#0a0',
      hasLogo: true,
      logoUrl: '/api/branding/logo',
    });
  });

  it('GET /branding/logo sem logo -> 404', async () => {
    const c = new BrandingController(svc({}) as any);
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;
    await expect(c.logo(res)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET /branding/logo devolve bytes com o mime salvo', async () => {
    const png = Buffer.from('PNGDATA').toString('base64');
    const c = new BrandingController(svc({ 'branding.logoData': png, 'branding.logoMime': 'image/png' }) as any);
    const res = { setHeader: vi.fn(), end: vi.fn() } as any;
    await c.logo(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('PNGDATA'));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/branding/branding.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o controller**

```ts
// backend/src/branding/branding.controller.ts
import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { SettingsService } from '../settings/settings.service.js';

@Controller('branding')
@Public()
export class BrandingController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async info() {
    const [companyName, primaryColor, logo] = await Promise.all([
      this.settings.get('branding.companyName'),
      this.settings.get('branding.primaryColor'),
      this.settings.get('branding.logoData'),
    ]);
    return {
      companyName: companyName ?? null,
      primaryColor: primaryColor ?? null,
      hasLogo: !!logo,
      logoUrl: '/api/branding/logo',
    };
  }

  @Get('logo')
  async logo(@Res() res: Response) {
    const [data, mime] = await Promise.all([
      this.settings.get('branding.logoData'),
      this.settings.get('branding.logoMime'),
    ]);
    if (!data) throw new NotFoundException('Logo não configurado.');
    res.setHeader('Content-Type', mime || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(Buffer.from(data, 'base64'));
  }
}
```

```ts
// backend/src/branding/branding.module.ts
import { Module } from '@nestjs/common';
import { BrandingController } from './branding.controller.js';

@Module({ controllers: [BrandingController] })
export class BrandingModule {}
```
Registrar `BrandingModule` em `app.module.ts`.

- [ ] **Step 4: Upload de logo no `SettingsController`**

```ts
// settings.controller.ts (novos imports + métodos)
import { Delete, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedFile as UF } from '../attachments/storage.util.js';

const LOGO_MAX = 512 * 1024;
const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml']);

@Post('branding/logo')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX } }))
async uploadLogo(@UploadedFile() file: UF) {
  if (!file) throw new BadRequestException('Arquivo ausente.');
  if (!LOGO_MIMES.has(file.mimetype)) {
    throw new BadRequestException(`Tipo de imagem não permitido: ${file.mimetype}.`);
  }
  if (file.size > LOGO_MAX) throw new BadRequestException('Logo excede 512 KB.');
  await this.settings.set('branding.logoData', file.buffer.toString('base64'));
  await this.settings.set('branding.logoMime', file.mimetype);
  return { ok: true };
}

@Delete('branding/logo')
async deleteLogo() {
  await this.settings.unset('branding.logoData');
  await this.settings.unset('branding.logoMime');
  return { ok: true };
}
```
`storage.util.ts` já exporta o tipo `UploadedFile`. Nota: `branding.logoData` está em `BULKY_KEYS`, então `describe()` devolve só `branding.logoDataSet`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd backend && npx vitest run src/branding src/settings && npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add backend/src/branding backend/src/settings backend/src/app.module.ts
git commit -m "feat(branding): endpoint público de marca + upload de logo (base64 no banco)"
```

---

## Task 8: Frontend — provider de branding no layout raiz

**Files:**
- Create: `frontend/src/lib/branding.ts`
- Create: `frontend/src/components/brand-mark.tsx`
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/components/nav.tsx`
- Modify: `frontend/src/components/login-form.tsx`

**Interfaces:**
- Consumes: `GET /api/branding`.
- Produces:
  - `lib/branding.ts`:
    - `interface Branding { companyName: string | null; primaryColor: string | null; hasLogo: boolean; logoUrl: string; }`
    - `fetchBranding(): Promise<Branding>` — `fetch` absoluto no server (usa `process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001'` + `/api/branding`), relativo `/api/branding` no client. Nunca lança: em erro devolve default `{ companyName: null, primaryColor: null, hasLogo: false, logoUrl: '/api/branding/logo' }`.
    - `useBranding(): Branding` — `useQuery(['branding'], ...)` com `initialData` do default.
  - `components/brand-mark.tsx`: `<BrandMark className?/>` — client component; renderiza `<img src={logoUrl}>` quando `hasLogo`, senão `<span>{companyName ?? 'Sistema de OS'}</span>`.

- [ ] **Step 1: Implementar `lib/branding.ts`**

```tsx
// frontend/src/lib/branding.ts
'use client';
import { useQuery } from '@tanstack/react-query';

export interface Branding {
  companyName: string | null;
  primaryColor: string | null;
  hasLogo: boolean;
  logoUrl: string;
}

export const DEFAULT_BRANDING: Branding = {
  companyName: null,
  primaryColor: null,
  hasLogo: false,
  logoUrl: '/api/branding/logo',
};

export async function fetchBranding(): Promise<Branding> {
  try {
    const base =
      typeof window === 'undefined'
        ? (process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:3001')
        : '';
    const res = await fetch(`${base}/api/branding`, { cache: 'no-store' });
    if (!res.ok) return DEFAULT_BRANDING;
    return (await res.json()) as Branding;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: fetchBranding,
    initialData: DEFAULT_BRANDING,
    staleTime: 60_000,
  });
  return data;
}
```

- [ ] **Step 2: `components/brand-mark.tsx`**

```tsx
'use client';
import { useBranding } from '@/lib/branding';

export function BrandMark({ className }: { className?: string }) {
  const { hasLogo, logoUrl, companyName } = useBranding();
  if (hasLogo) {
    return <img src={logoUrl} alt={companyName ?? 'Logo'} className={className ?? 'h-8 w-auto'} />;
  }
  return <span className={className ?? 'text-sm font-semibold'}>{companyName ?? 'Sistema de OS'}</span>;
}
```

- [ ] **Step 3: `app/layout.tsx` — metadata dinâmica + cor + favicon**

Trocar o `export const metadata` fixo por:
```tsx
import { fetchBranding } from '@/lib/branding';

export async function generateMetadata() {
  const b = await fetchBranding();
  return {
    title: b.companyName ?? 'Sistema de OS',
    description: 'Sistema de ordens de serviço',
    icons: b.hasLogo ? { icon: '/api/branding/logo' } : undefined,
  };
}
```
No corpo do `RootLayout`, antes de `<Providers>`, injetar a cor primária quando houver:
```tsx
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await fetchBranding();
  return (
    <html lang="pt-BR">
      {b.primaryColor && (
        <head>
          <style>{`:root{--primary:${b.primaryColor};--ring:${b.primaryColor}}`}</style>
        </head>
      )}
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```
(Validação da cor é no backend; aqui confia. `RootLayout` já pode ser `async` — é Server Component.)

- [ ] **Step 4: `nav.tsx` — usar `<BrandMark>`**

Em `AppNav`: trocar `<div className="px-2 py-3 text-sm font-semibold">Sistema de OS</div>` por `<div className="px-2 py-3"><BrandMark /></div>`.
Em `PortalNav`: trocar o texto `Meus chamados` do `<Link>` por `<BrandMark />` (manter o link para `/portal`).
Import: `import { BrandMark } from '@/components/brand-mark';`.

- [ ] **Step 5: `login-form.tsx` — logo/nome no topo**

Adicionar, acima do título do form, `<div className="mb-6 flex justify-center"><BrandMark className="h-10 w-auto" /></div>`.

- [ ] **Step 6: Verificar build**

Run: `cd frontend && npm run build`
Expected: build passa. (Sem servidor rodando, `fetchBranding` no server cai no default — ok.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/branding.ts frontend/src/components/brand-mark.tsx frontend/src/app/layout.tsx frontend/src/components/nav.tsx frontend/src/components/login-form.tsx
git commit -m "feat(branding): logo, nome e cor primária no app, portal e login"
```

---

## Task 9: Frontend — abas E-mail / Armazenamento / Aparência na tela de config

**Files:**
- Create: `frontend/src/app/app/config/tabs/email-tab.tsx`
- Create: `frontend/src/app/app/config/tabs/storage-tab.tsx`
- Create: `frontend/src/app/app/config/tabs/appearance-tab.tsx`
- Modify: `frontend/src/app/app/config/page.tsx`

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT /api/settings`, `POST /api/settings/storage/test`, `POST /api/settings/branding/logo`, `DELETE /api/settings/branding/logo`, `useSession()` (para `role`).
- Produces: 3 componentes de aba, cada um default-exportando `function XxxTab()`. `page.tsx` adiciona as abas ao array `tabs` só quando `user.role === 'ADMIN'` e faz o `&&` de render.

- [ ] **Step 1: Aba E-mail**

```tsx
// frontend/src/app/app/config/tabs/email-tab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function EmailTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [form, setForm] = useState({ apiKey: '', from: '', inboundSecret: '' });
  useEffect(() => {
    if (data) setForm((f) => ({ ...f, from: (data['mail.from'] as string) ?? '' }));
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'mail.from': form.from,
            ...(form.apiKey ? { 'resend.apiKey': form.apiKey } : {}),
            ...(form.inboundSecret ? { 'resend.inboundSecret': form.inboundSecret } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setForm((f) => ({ ...f, apiKey: '', inboundSecret: '' }));
      toast.success('Configurações de e-mail salvas.');
    },
    onError: errToast,
  });

  const keySet = data?.['resend.apiKeySet'] === true;
  const secretSet = data?.['resend.inboundSecretSet'] === true;

  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      {data && data.encryptionKeySet === false && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Defina a variável <code>APP_ENCRYPTION_KEY</code> no servidor para poder salvar segredos.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label>Chave da API do Resend</Label>
        <Input
          type="password"
          placeholder={keySet ? '•••••••• (configurada)' : 'rk_live_…'}
          value={form.apiKey}
          onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Remetente (From)</Label>
        <Input
          placeholder="suporte@suaempresa.com.br"
          value={form.from}
          onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Segredo do webhook inbound</Label>
        <Input
          type="password"
          placeholder={secretSet ? '•••••••• (configurado)' : ''}
          value={form.inboundSecret}
          onChange={(e) => setForm((f) => ({ ...f, inboundSecret: e.target.value }))}
        />
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending} className="self-start">
        Salvar
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Aba Armazenamento**

```tsx
// frontend/src/app/app/config/tabs/storage-tab.tsx
'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
const S3_FIELDS = [
  ['storage.s3.endpoint', 'Endpoint (R2/MinIO — deixe vazio p/ AWS)'],
  ['storage.s3.region', 'Região'],
  ['storage.s3.bucket', 'Bucket'],
  ['storage.s3.prefix', 'Prefixo (opcional)'],
] as const;

export default function StorageTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!data) return;
    setF({
      'storage.driver': (data['storage.driver'] as string) || 'disk',
      'storage.s3.endpoint': (data['storage.s3.endpoint'] as string) ?? '',
      'storage.s3.region': (data['storage.s3.region'] as string) ?? '',
      'storage.s3.bucket': (data['storage.s3.bucket'] as string) ?? '',
      'storage.s3.prefix': (data['storage.s3.prefix'] as string) ?? '',
      'storage.s3.forcePathStyle': (data['storage.s3.forcePathStyle'] as string) || 'false',
      accessKeyId: '',
      secretAccessKey: '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: {
            'storage.driver': f['storage.driver'],
            ...Object.fromEntries(S3_FIELDS.map(([k]) => [k, f[k] ?? ''])),
            'storage.s3.forcePathStyle': f['storage.s3.forcePathStyle'],
            ...(f.accessKeyId ? { 'storage.s3.accessKeyId': f.accessKeyId } : {}),
            ...(f.secretAccessKey ? { 'storage.s3.secretAccessKey': f.secretAccessKey } : {}),
          },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setF((s) => ({ ...s, accessKeyId: '', secretAccessKey: '' }));
      toast.success('Configurações de armazenamento salvas.');
    },
    onError: errToast,
  });

  const test = useMutation({
    mutationFn: () => api('/settings/storage/test', { method: 'POST' }),
    onSuccess: () => toast.success('Conexão com o armazenamento OK.'),
    onError: errToast,
  });

  const isS3 = f['storage.driver'] === 's3';
  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        <Label>Onde guardar os anexos</Label>
        <Select
          value={f['storage.driver'] ?? 'disk'}
          onChange={(e) => setF((s) => ({ ...s, 'storage.driver': e.target.value }))}
        >
          <option value="disk">Disco local do servidor</option>
          <option value="s3">Bucket S3 (AWS, Cloudflare R2, MinIO)</option>
        </Select>
      </div>
      {isS3 && (
        <>
          {S3_FIELDS.map(([k, label]) => (
            <div key={k} className="flex flex-col gap-1">
              <Label>{label}</Label>
              <Input value={f[k] ?? ''} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label>Access Key ID</Label>
            <Input
              type="password"
              placeholder={data?.['storage.s3.accessKeyIdSet'] ? '•••••••• (configurada)' : ''}
              value={f.accessKeyId ?? ''}
              onChange={(e) => setF((s) => ({ ...s, accessKeyId: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Secret Access Key</Label>
            <Input
              type="password"
              placeholder={data?.['storage.s3.secretAccessKeySet'] ? '•••••••• (configurada)' : ''}
              value={f.secretAccessKey ?? ''}
              onChange={(e) => setF((s) => ({ ...s, secretAccessKey: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={f['storage.s3.forcePathStyle'] === 'true'}
              onChange={(e) =>
                setF((s) => ({ ...s, 'storage.s3.forcePathStyle': e.target.checked ? 'true' : 'false' }))
              }
            />
            Forçar path-style (MinIO / alguns provedores)
          </label>
        </>
      )}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Salvar
        </Button>
        {isS3 && (
          <Button variant="ghost" onClick={() => test.mutate()} disabled={test.isPending}>
            Testar conexão
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Anexos já enviados continuam sendo lidos de onde foram gravados. Só os novos vão para o destino atual.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Aba Aparência**

```tsx
// frontend/src/app/app/config/tabs/appearance-tab.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export default function AppearanceTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [name, setName] = useState('');
  const [color, setColor] = useState('#2563eb');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!data) return;
    setName((data['branding.companyName'] as string) ?? '');
    setColor((data['branding.primaryColor'] as string) || '#2563eb');
  }, [data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['settings'] });
    qc.invalidateQueries({ queryKey: ['branding'] });
  };

  const save = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: { values: { 'branding.companyName': name, 'branding.primaryColor': color } },
      }),
    onSuccess: () => {
      refresh();
      toast.success('Aparência salva.');
    },
    onError: errToast,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/settings/branding/logo', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    },
    onSuccess: () => {
      refresh();
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Logo atualizado.');
    },
    onError: errToast,
  });

  const removeLogo = useMutation({
    mutationFn: () => api('/settings/branding/logo', { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Logo removido.');
    },
    onError: errToast,
  });

  const hasLogo = data?.['branding.logoDataSet'] === true;
  return (
    <div className="flex max-w-lg flex-col gap-4 pt-4">
      <div className="flex flex-col gap-1">
        <Label>Nome da empresa</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sua Empresa Ltda" />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Cor primária</Label>
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2563eb'}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-16 rounded border border-border bg-transparent"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Logo</Label>
        {hasLogo && (
          <img src="/api/branding/logo" alt="Logo atual" className="h-12 w-auto rounded border border-border p-1" />
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">PNG, JPEG, WebP ou SVG. Até 512 KB.</p>
        {hasLogo && (
          <button
            type="button"
            className="self-start text-sm text-primary hover:underline"
            onClick={() => removeLogo.mutate()}
          >
            Remover logo
          </button>
        )}
      </div>
      <Button onClick={() => save.mutate()} disabled={save.isPending} className="self-start">
        Salvar
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Ligar as abas no `page.tsx`**

Em `frontend/src/app/app/config/page.tsx`:
- Import `useSession` de `@/lib/auth` e os 3 componentes (`import EmailTab from './tabs/email-tab';` etc.).
- No `ConfigPage`:
  ```tsx
  const { user } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const tabs = [
    { value: 'categorias', label: 'Categorias' },
    { value: 'sla', label: 'SLA' },
    { value: 'usuarios', label: 'Usuários internos' },
    ...(isAdmin
      ? [
          { value: 'email', label: 'E-mail' },
          { value: 'armazenamento', label: 'Armazenamento' },
          { value: 'aparencia', label: 'Aparência' },
        ]
      : []),
  ];
  ```
  Passar `tabs={tabs}` ao `<Tabs>` e adicionar:
  ```tsx
  {tab === 'email' && isAdmin && <EmailTab />}
  {tab === 'armazenamento' && isAdmin && <StorageTab />}
  {tab === 'aparencia' && isAdmin && <AppearanceTab />}
  ```

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: passa.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/app/config
git commit -m "feat(config): abas E-mail, Armazenamento e Aparência (ADMIN)"
```

---

## Task 10: `BackupService` — export/import

**Files:**
- Create: `backend/src/backup/backup.service.ts`
- Create: `backend/src/backup/backup.service.spec.ts`
- Create: `backend/src/backup/backup.module.ts`
- Create: `backend/test/integration/backup.integration.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `BACKUP_VERSION = 1`.
  - `interface BackupFile { meta: { version: number; exportedAt: string; appVersion: string }; data: Record<string, unknown[]> }`.
  - `BackupService.export(): Promise<BackupFile>` — lê, em ordem: `users, clients, categories, slaPolicy, tickets, ticketComment, ticketEvent, attachment, inboundEmail, counter, setting`. `refreshToken` fora.
  - `BackupService.import(file: BackupFile): Promise<void>` — valida `meta.version === BACKUP_VERSION` e presença de `data` (senão `BadRequestException` antes de tocar o banco). Em `prisma.$transaction`: `deleteMany` em ordem reversa de FK, `createMany` em ordem direta.
  - `TABLE_ORDER: string[]` (ordem direta de FK) exportado para o teste.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/backup/backup.service.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BACKUP_VERSION, BackupService, TABLE_ORDER } from './backup.service.js';

function makePrisma() {
  const p: any = { $transaction: vi.fn(async (fn: any) => fn(p)) };
  for (const t of TABLE_ORDER) {
    p[t] = {
      findMany: vi.fn(async () => [{ id: `${t}-1` }]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
      createMany: vi.fn(async () => ({ count: 1 })),
    };
  }
  return p;
}

describe('BackupService.export', () => {
  it('inclui todas as tabelas do TABLE_ORDER e não inclui refreshToken', async () => {
    const prisma = makePrisma();
    const file = await new BackupService(prisma as any).export();
    expect(file.meta.version).toBe(BACKUP_VERSION);
    for (const t of TABLE_ORDER) expect(file.data[t]).toHaveLength(1);
    expect(file.data.refreshToken).toBeUndefined();
  });
});

describe('BackupService.import', () => {
  it('rejeita versão errada antes de qualquer deleteMany', async () => {
    const prisma = makePrisma();
    const svc = new BackupService(prisma as any);
    await expect(svc.import({ meta: { version: 99 }, data: {} } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
  });

  it('rejeita payload sem data', async () => {
    const svc = new BackupService(makePrisma() as any);
    await expect(svc.import({ meta: { version: BACKUP_VERSION } } as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('apaga em ordem reversa e recria em ordem direta', async () => {
    const prisma = makePrisma();
    const svc = new BackupService(prisma as any);
    const data = Object.fromEntries(TABLE_ORDER.map((t) => [t, [{ id: `${t}-1` }]]));
    await svc.import({ meta: { version: BACKUP_VERSION }, data } as any);
    // primeiro deleteMany é da última tabela do TABLE_ORDER
    const firstDeleted = TABLE_ORDER.at(-1)!;
    expect(prisma[firstDeleted].deleteMany).toHaveBeenCalled();
    expect(prisma[TABLE_ORDER[0]].createMany).toHaveBeenCalledWith({
      data: [{ id: `${TABLE_ORDER[0]}-1` }],
      skipDuplicates: false,
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/backup/backup.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// backend/src/backup/backup.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const BACKUP_VERSION = 1;

/** Ordem direta de FK: pais antes de filhos. Delete usa o reverso. */
export const TABLE_ORDER = [
  'client',
  'user',
  'category',
  'slaPolicy',
  'counter',
  'setting',
  'ticket',
  'ticketComment',
  'ticketEvent',
  'attachment',
  'inboundEmail',
] as const;

export interface BackupFile {
  meta: { version: number; exportedAt: string; appVersion: string };
  data: Record<string, unknown[]>;
}

@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  async export(): Promise<BackupFile> {
    const data: Record<string, unknown[]> = {};
    for (const t of TABLE_ORDER) {
      data[t] = await (this.prisma as any)[t].findMany();
    }
    return {
      meta: {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: process.env.npm_package_version ?? '0.0.0',
      },
      data,
    };
  }

  async import(file: BackupFile): Promise<void> {
    if (!file || typeof file !== 'object' || file.meta?.version !== BACKUP_VERSION) {
      throw new BadRequestException(
        `Backup incompatível: esperado version ${BACKUP_VERSION}.`,
      );
    }
    if (!file.data || typeof file.data !== 'object') {
      throw new BadRequestException('Backup sem o bloco "data".');
    }
    // ponytail: dataset do MVP cabe em memória e numa transação só.
    // Se algum dia passar de ~100k linhas, quebrar em lotes por tabela.
    await this.prisma.$transaction(async (tx) => {
      for (const t of [...TABLE_ORDER].reverse()) {
        await (tx as any)[t].deleteMany({});
      }
      for (const t of TABLE_ORDER) {
        const rows = file.data[t] ?? [];
        if (rows.length) await (tx as any)[t].createMany({ data: rows, skipDuplicates: false });
      }
    });
  }
}
```

```ts
// backend/src/backup/backup.module.ts
import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';

@Module({
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
```
Registrar `BackupModule` em `app.module.ts`.

- [ ] **Step 4: Teste de integração**

```ts
// backend/test/integration/backup.integration.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { BackupService } from '../../src/backup/backup.service.js';

const prisma = new PrismaClient();
const svc = new BackupService(prisma as any);

describe('BackupService round-trip (Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.client.create({ data: { name: 'Cliente Backup Teste' } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('export -> import reproduz as linhas', async () => {
    const before = await svc.export();
    const clientsBefore = before.data.client.length;
    expect(clientsBefore).toBeGreaterThan(0);
    await svc.import(before);
    const after = await svc.export();
    expect(after.data.client.length).toBe(clientsBefore);
  });
});
```

- [ ] **Step 5: Rodar**

Run: `cd backend && npx vitest run src/backup/backup.service.spec.ts && npm test`
Expected: unit verde. Integração:
Run: `cd backend && npm run test:integration` (se Postgres disponível; senão anotar no ledger).

- [ ] **Step 6: Commit**

```bash
git add backend/src/backup backend/test/integration/backup.integration.spec.ts backend/src/app.module.ts
git commit -m "feat(backup): BackupService export/import (restauração total em transação)"
```

---

## Task 11: `BackupController` — export / import / list

**Files:**
- Create: `backend/src/backup/backup.controller.ts`
- Create: `backend/src/backup/backup.controller.spec.ts`
- Create: `backend/src/backup/dto/import-backup.dto.ts`
- Modify: `backend/src/backup/backup.module.ts` (registrar controller; importar nada — `StorageService` é global)

**Interfaces:**
- Consumes: `BackupService`, `StorageService`, `CurrentUser`.
- Produces:
  - `GET /api/backup/export` (ADMIN) → seta `Content-Type: application/json` e `Content-Disposition: attachment; filename="os-backup-<ISO>.json"`, escreve `JSON.stringify(await backup.export(), null, 2)`.
  - `POST /api/backup/import` (ADMIN, `FileInterceptor('file')`, body `confirm`) → exige `confirm === 'RESTAURAR'` (senão `BadRequestException`); faz `JSON.parse` do buffer (erro → `BadRequestException`); chama `backup.import`; loga `actor.email`. Retorna `{ ok: true }`.
  - `GET /api/backup/list` (ADMIN) → `storage.list('backups/')` mapeado para `[{ name }]` ordenado desc.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/backup/backup.controller.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BackupController } from './backup.controller.js';

const backup = { export: vi.fn(async () => ({ meta: { version: 1 }, data: {} })), import: vi.fn() };
const storage = { list: vi.fn(async () => ['backups/os-backup-2026-09-01.json']) };
const actor = { id: 'u1', email: 'admin@x.com' } as any;

describe('BackupController', () => {
  it('export escreve JSON com header de download', async () => {
    const c = new BackupController(backup as any, storage as any);
    const res: any = { setHeader: vi.fn(), send: vi.fn() };
    await c.export(res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="os-backup-'),
    );
    expect(res.send).toHaveBeenCalled();
  });

  it('import sem confirm="RESTAURAR" recusa', async () => {
    const c = new BackupController(backup as any, storage as any);
    await expect(
      c.import({ buffer: Buffer.from('{}') } as any, { confirm: 'x' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(backup.import).not.toHaveBeenCalled();
  });

  it('import com JSON inválido recusa', async () => {
    const c = new BackupController(backup as any, storage as any);
    await expect(
      c.import({ buffer: Buffer.from('nao-json') } as any, { confirm: 'RESTAURAR' }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('import feliz chama backup.import', async () => {
    const c = new BackupController(backup as any, storage as any);
    await c.import(
      { buffer: Buffer.from('{"meta":{"version":1},"data":{}}') } as any,
      { confirm: 'RESTAURAR' },
      actor,
    );
    expect(backup.import).toHaveBeenCalled();
  });

  it('list devolve nomes ordenados desc', async () => {
    storage.list.mockResolvedValueOnce([
      'backups/os-backup-2026-09-01.json',
      'backups/os-backup-2026-09-03.json',
    ]);
    const c = new BackupController(backup as any, storage as any);
    expect(await c.list()).toEqual([
      { name: 'backups/os-backup-2026-09-03.json' },
      { name: 'backups/os-backup-2026-09-01.json' },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/backup/backup.controller.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o DTO + controller**

```ts
// backend/src/backup/dto/import-backup.dto.ts
import { IsString } from 'class-validator';
export class ImportBackupDto {
  @IsString()
  confirm!: string;
}
```

```ts
// backend/src/backup/backup.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import type { UploadedFile as UF } from '../attachments/storage.util.js';
import { BackupService } from './backup.service.js';
import { ImportBackupDto } from './dto/import-backup.dto.js';

@Controller('backup')
@Roles('ADMIN')
export class BackupController {
  private readonly logger = new Logger(BackupController.name);

  constructor(
    private readonly backup: BackupService,
    private readonly storage: StorageService,
  ) {}

  @Get('export')
  async export(@Res() res: Response) {
    const file = await this.backup.export();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="os-backup-${stamp}.json"`);
    res.send(JSON.stringify(file, null, 2));
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  async import(
    @UploadedFile() file: UF,
    @Body() dto: ImportBackupDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    if (dto.confirm !== 'RESTAURAR') {
      throw new BadRequestException('Digite RESTAURAR para confirmar a restauração total.');
    }
    if (!file) throw new BadRequestException('Envie o arquivo de backup.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.buffer.toString('utf8'));
    } catch {
      throw new BadRequestException('Arquivo não é um JSON válido.');
    }
    this.logger.warn(`Restauração total disparada por ${actor.email}`);
    await this.backup.import(parsed as never);
    return { ok: true };
  }

  @Get('list')
  async list() {
    const names = await this.storage.list('backups/');
    return names.sort().reverse().map((name) => ({ name }));
  }
}
```
Registrar `BackupController` em `backup.module.ts` (`controllers: [BackupController]`).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npx vitest run src/backup && npm test`
Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add backend/src/backup
git commit -m "feat(backup): endpoints GET /backup/export, POST /backup/import, GET /backup/list"
```

---

## Task 12: `BackupCron` — backup diário pro storage + poda

**Files:**
- Create: `backend/src/backup/backup.cron.ts`
- Create: `backend/src/backup/backup.cron.spec.ts`
- Modify: `backend/src/tasks/tasks.module.ts`
- Modify: `backend/src/backup/backup.module.ts` (garantir `BackupService` exportado — já está)

**Interfaces:**
- Consumes: `BackupService.export()`, `StorageService.put`/`list`/`remove`, `SettingsService.getBool('backup.s3.enabled')` + `getNumber('backup.retention')`.
- Produces: `BackupCron.run()` — `@Cron('0 3 * * *')`. No-op se `backup.s3.enabled` != true. Grava `backups/os-backup-<ISO>.json`. Poda mantendo `retention` (default 30) mais recentes.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// backend/src/backup/backup.cron.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { BackupCron } from './backup.cron.js';

function make(enabled: boolean, existing: string[] = [], retention?: number) {
  const settings = {
    getBool: vi.fn(async () => enabled),
    getNumber: vi.fn(async () => retention),
  };
  const backup = { export: vi.fn(async () => ({ meta: { version: 1 }, data: {} })) };
  const storage = {
    put: vi.fn(async () => undefined),
    list: vi.fn(async () => existing),
    remove: vi.fn(async () => undefined),
  };
  const cron = new BackupCron(settings as any, backup as any, storage as any);
  vi.spyOn((cron as any).logger, 'log').mockImplementation(() => {});
  vi.spyOn((cron as any).logger, 'error').mockImplementation(() => {});
  return { cron, settings, backup, storage };
}

describe('BackupCron', () => {
  it('desligado: não exporta nem grava', async () => {
    const { cron, backup, storage } = make(false);
    await cron.run();
    expect(backup.export).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('ligado: exporta e grava um backups/os-backup-*.json', async () => {
    const { cron, storage } = make(true);
    await cron.run();
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(storage.put.mock.calls[0][0]).toMatch(/^backups\/os-backup-.*\.json$/);
  });

  it('poda mantém os N mais recentes (retention=2)', async () => {
    const existing = [
      'backups/os-backup-2026-09-01.json',
      'backups/os-backup-2026-09-02.json',
      'backups/os-backup-2026-09-03.json',
      'backups/os-backup-2026-09-04.json',
    ];
    const { cron, storage } = make(true, existing, 2);
    await cron.run();
    // sobra a lista + o novo; remove os mais antigos além de 2
    expect(storage.remove).toHaveBeenCalled();
    const removed = storage.remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('backups/os-backup-2026-09-01.json');
    expect(removed).not.toContain('backups/os-backup-2026-09-04.json');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx vitest run src/backup/backup.cron.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
// backend/src/backup/backup.cron.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SettingsService } from '../settings/settings.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BackupService } from './backup.service.js';

const DEFAULT_RETENTION = 30;

/**
 * Backup diário do banco (JSON) para o storage ativo.
 * ponytail: sem lock — instância única, igual ao SlaBreachCron. Poda por nome
 * (o timestamp ISO ordena lexicograficamente).
 */
@Injectable()
export class BackupCron {
  private readonly logger = new Logger(BackupCron.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly backup: BackupService,
    private readonly storage: StorageService,
  ) {}

  @Cron('0 3 * * *')
  async run(): Promise<void> {
    if (!(await this.settings.getBool('backup.s3.enabled'))) return;
    try {
      const json = JSON.stringify(await this.backup.export());
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = `backups/os-backup-${stamp}.json`;
      await this.storage.put(name, Buffer.from(json), 'application/json');

      const keep = (await this.settings.getNumber('backup.retention')) ?? DEFAULT_RETENTION;
      const all = (await this.storage.list('backups/')).sort().reverse();
      for (const old of all.slice(keep)) {
        await this.storage.remove(old);
      }
      this.logger.log(`Backup gravado: ${name} (retenção ${keep})`);
    } catch (err) {
      this.logger.error(`Falha no backup diário: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Registrar no `TasksModule`**

```ts
// backend/src/tasks/tasks.module.ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { SlaBreachCron } from './sla-breach.cron.js';
import { BackupCron } from '../backup/backup.cron.js';

@Module({
  imports: [NotificationsModule, BackupModule],
  providers: [SlaBreachCron, BackupCron],
})
export class TasksModule {}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd backend && npx vitest run src/backup && npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add backend/src/backup/backup.cron.ts backend/src/backup/backup.cron.spec.ts backend/src/tasks/tasks.module.ts
git commit -m "feat(backup): cron diário de backup para o storage com retenção"
```

---

## Task 13: Frontend — aba Backup

**Files:**
- Create: `frontend/src/app/app/config/tabs/backup-tab.tsx`
- Modify: `frontend/src/app/app/config/page.tsx` (registrar a aba)

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT /api/settings` (`backup.s3.enabled`, `backup.retention`), `GET /api/backup/list`, `GET /api/backup/export` (download direto), `POST /api/backup/import` (multipart).
- Produces: `export default function BackupTab()`.

- [ ] **Step 1: Implementar a aba**

```tsx
// frontend/src/app/app/config/tabs/backup-tab.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;
const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

async function downloadExport() {
  const res = await fetch('/api/backup/export', {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+?)"/)?.[1] ?? 'os-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const list = useQuery({
    queryKey: ['backup', 'list'],
    queryFn: () => api<{ name: string }[]>('/backup/list'),
  });
  const [enabled, setEnabled] = useState(false);
  const [retention, setRetention] = useState('30');
  const [confirm, setConfirm] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!data) return;
    setEnabled(data['backup.s3.enabled'] === 'true');
    setRetention((data['backup.retention'] as string) || '30');
  }, [data]);

  const saveCfg = useMutation({
    mutationFn: () =>
      api('/settings', {
        method: 'PUT',
        body: {
          values: { 'backup.s3.enabled': enabled ? 'true' : 'false', 'backup.retention': retention },
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Configuração de backup salva.');
    },
    onError: errToast,
  });

  const download = useMutation({ mutationFn: downloadExport, onError: errToast });

  const doImport = useMutation({
    mutationFn: async () => {
      const f = fileRef.current?.files?.[0];
      if (!f) throw new ApiError(400, { message: 'Escolha um arquivo .json.' });
      const body = new FormData();
      body.append('file', f);
      body.append('confirm', confirm);
      const res = await fetch('/api/backup/import', {
        method: 'POST',
        body,
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        credentials: 'include',
      });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    },
    onSuccess: () => {
      toast.success('Restauração concluída. Você pode precisar entrar de novo.');
      setConfirm('');
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: errToast,
  });

  return (
    <div className="flex max-w-lg flex-col gap-6 pt-4">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Backup manual</h2>
        <Button onClick={() => download.mutate()} disabled={download.isPending} className="self-start">
          Baixar backup agora (.json)
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Backup automático</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Gravar um backup diário (03:00) no armazenamento configurado
        </label>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label>Manter os últimos</Label>
            <Input
              type="number"
              min={1}
              className="w-24"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
          </div>
          <Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>
            Salvar
          </Button>
        </div>
        <ul className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          {list.data?.map((b) => <li key={b.name}>{b.name.replace('backups/', '')}</li>)}
          {list.data && list.data.length === 0 && <li>Nenhum backup automático ainda.</li>}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-red-600">Restaurar (apaga todos os dados atuais)</h2>
        <p className="text-xs text-muted-foreground">
          Substitui todo o conteúdo do sistema pelo do arquivo. Exige a mesma chave de criptografia
          (<code>APP_ENCRYPTION_KEY</code>) do servidor de origem para os segredos voltarem a funcionar.
        </p>
        <input ref={fileRef} type="file" accept="application/json,.json" className="text-sm" />
        <Input
          placeholder='Digite RESTAURAR para confirmar'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <Button
          variant="ghost"
          className="self-start text-red-600 hover:bg-red-50"
          disabled={confirm !== 'RESTAURAR' || doImport.isPending}
          onClick={() => doImport.mutate()}
        >
          Importar e restaurar
        </Button>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a aba no `page.tsx`**

No array `tabs` (bloco `isAdmin ? [...]`) adicionar `{ value: 'backup', label: 'Backup' }` e no corpo `{tab === 'backup' && isAdmin && <BackupTab />}`. Import `import BackupTab from './tabs/backup-tab';`.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: passa.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/app/config
git commit -m "feat(config): aba Backup (download, restauração, backup diário)"
```

---

## Task 14: Docs, env de exemplo e bump de versão

**Files:**
- Modify: `deploy/stack.env.example`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `backend/package.json`, `frontend/package.json` (version `0.2.0`)
- Modify: `backend/src/email/*` / docs onde houver menção a "configure via .env" (revisar)

- [ ] **Step 1: `deploy/stack.env.example`**

Adicionar bloco:
```
# --- Criptografia de segredos das Configurações (obrigatório para salvar Resend/S3 pela UI) ---
# Gere com: openssl rand -base64 32
APP_ENCRYPTION_KEY=

# --- Legado / opcional ---
# RESEND_API_KEY, MAIL_FROM, RESEND_INBOUND_SECRET e STORAGE_PATH continuam
# funcionando como fallback, mas o recomendado agora é configurar em
# /app/config (abas E-mail e Armazenamento).
```
Se `RESEND_API_KEY` etc. estavam como obrigatórios no arquivo, mover para a seção "Legado / opcional" com comentário.

- [ ] **Step 2: `README.md`**

Na seção de configuração/deploy: uma subseção "Configurações no app" explicando que Resend, S3, aparência e backup agora vivem em `/app/config` (ADMIN), e que `APP_ENCRYPTION_KEY` é obrigatória para segredos. Nota sobre restauração exigir a mesma chave.

- [ ] **Step 3: `CHANGELOG.md`**

Nova seção:
```markdown
## [0.2.0] - 2026-09-09

### Added
- Configurações no app (`/app/config`, ADMIN): credenciais do Resend, armazenamento S3, aparência e backup — antes só via `.env`.
- Segredos de configuração criptografados no banco (AES-256-GCM); nova env `APP_ENCRYPTION_KEY`.
- Armazenamento de anexos em bucket S3 (AWS/R2/MinIO), com leitura retrocompatível dos anexos já em disco.
- Backup dos dados em JSON: download sob demanda, restauração total e backup diário automático para o storage com retenção configurável.
- Aparência: logo, nome da empresa e cor primária no app, portal, telas de login, e-mails e título/favicon.

### Changed
- Resend e o webhook inbound passam a ler configuração do banco, com o `.env` como fallback.
```

- [ ] **Step 4: Bump de versão**

Editar `"version"` para `0.2.0` em `backend/package.json` e `frontend/package.json`.

- [ ] **Step 5: Verificação final**

Run:
```bash
cd backend && npm test && npm run lint
cd ../frontend && npm run build
```
Expected: tudo verde.

- [ ] **Step 6: Commit + tag**

```bash
git add deploy/stack.env.example README.md CHANGELOG.md backend/package.json frontend/package.json
git commit -m "chore: release 0.2.0 — configurações do sistema no app"
git tag v0.2.0
```

- [ ] **Step 7: Push + sync do Z:**

```bash
git push origin main --tags
git -C "Z:/Projetos/OS" pull --ff-only origin main
```

---

## Self-Review

**1. Cobertura do spec:**

| Item do spec | Task |
|---|---|
| §2 segredos AES-256-GCM + `APP_ENCRYPTION_KEY` | 1, 2 |
| §2 fallback pro env legado | 2 |
| §3.2 model `Setting` + `SettingsService` (get/set/cache/describe) | 2 |
| §3.2 catálogo de chaves + mapa env | 2 |
| §3.3 `StorageService` + `DiskStorageDriver` + dual-read | 4 |
| §3.3 `S3StorageDriver` (`@aws-sdk/client-s3`) | 5 |
| §3.4 `EmailService`/templates/`InboundController` via settings | 6 |
| §3.4 `AttachmentsService` grava/lê pelo storage; `storedPath` vira key | 4 |
| §3.5 `BrandingController` público + `GET /branding` + `/branding/logo` | 7 |
| §3.5 upload/remoção de logo (base64 no banco, ≤512 KB) | 7 |
| §3.6 `BackupService.export` (tabelas, sem refreshTokens) | 10 |
| §3.6 `BackupService.import` restauração total transacional + validação | 10 |
| §3.6 `GET /backup/export` download, `POST /backup/import` (confirm), `GET /backup/list` | 11 |
| §3.7 `BackupCron` diário + poda por retenção | 12 |
| §3.8 `getBranding` + root layout (title/favicon/cor) | 8 |
| §3.8 headers app/portal + logins com `<BrandMark>` | 8 |
| §3.8 abas E-mail/Armazenamento/Aparência (ADMIN) | 9 |
| §3.8 aba Backup | 13 |
| §3.9 migração `Setting`; `APP_ENCRYPTION_KEY` documentada; env legado como fallback | 2, 14 |
| §5 erros e bordas (chave ausente, S3 falho, import inválido, mime/size logo, cor inválida) | 2, 5, 7, 10, 11 |
| §6 testes unit + integração | cada task + 10 |
| §8 bump 0.2.0 + CHANGELOG | 14 |

Sem lacunas.

**2. Varredura de placeholders:** todos os steps de código têm código real; testes têm asserções concretas. Onde um arquivo depende de outro criado mais tarde (`s3.driver.ts` na Task 4), o stub explícito está no plano.

**3. Consistência de tipos/nomes:**
- `SettingsService`: `get/getBool/getNumber/getMany/set/unset/describe` — mesmos nomes nas Tasks 2, 3, 5, 6, 7, 10, 12.
- `StorageService`: `put/readable/remove/exists/list/activeDriver/testConnection` — consistente nas Tasks 4, 5, 11, 12. `remove` (não `delete`) em todo lugar.
- `StorageDriver` interface idêntica nas Tasks 4 e 5.
- `BackupFile` / `TABLE_ORDER` / `BACKUP_VERSION` — definidos na Task 10, usados nas 11 e 12.
- `Attachment.storedPath` = key relativa para linhas novas; dual-read por `isLegacyDiskPath` — coerente entre Tasks 4 e 6.
- Chaves de `Setting` batem entre `settings.keys.ts` (Task 2) e o front (Tasks 9, 13): `resend.apiKey`, `mail.from`, `resend.inboundSecret`, `storage.driver`, `storage.s3.*`, `backup.s3.enabled`, `backup.retention`, `branding.companyName`, `branding.primaryColor`, `branding.logoData`, `branding.logoMime`.
- `describe()` expõe segredos como `<key>Set` — o front lê `resend.apiKeySet`, `storage.s3.accessKeyIdSet`, `branding.logoDataSet`. Consistente.

Sem inconsistências.

---

## Execution Handoff

**Plano completo e salvo em `docs/superpowers/plans/2026-09-09-configuracoes-sistema.md`. Duas opções de execução:**

**1. Subagent-Driven (recomendado)** — um subagente novo por task, revisão entre tasks, iteração rápida.

**2. Inline** — executar as tasks nesta sessão com `executing-plans`, em lotes com checkpoints de revisão.

**Qual você prefere?**
