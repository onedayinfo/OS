# Configurações do sistema: Resend, S3, backup e aparência

Data: 2026-09-08
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `6d78821` (release 0.1.1)

## 1. Objetivo

Tirar configuração operacional do `.env` e levar pra tela de Configurações
(`/app/config`), acessível só a `ADMIN`. Quatro frentes:

1. **E-mail (Resend)** — chave da API, remetente e segredo do webhook inbound
   passam a viver no banco (criptografados), com o `.env` como fallback durante
   a transição.
2. **Armazenamento (S3)** — anexos podem ser gravados/lidos de um bucket S3
   compatível (AWS S3, Cloudflare R2, MinIO) em vez do disco local.
3. **Backup** — download sob demanda de um JSON com todos os dados, importação
   (restauração total) desse JSON, e um cron diário que empurra o mesmo JSON
   pro storage ativo com retenção.
4. **Aparência** — nome da empresa, logo e cor primária configuráveis,
   refletidos no app, no portal, nas telas de login, nos e-mails e no
   título/favicon da aba.

Fora de escopo: rodar o Postgres "no S3" (impossível — só backup); multi-tenant;
cofre de segredos externo (Vault/KMS); tema completo (só 1 cor primária).

## 2. Decisões travadas (do brainstorm)

- Segredos no banco **criptografados** (AES-256-GCM) com `APP_ENCRYPTION_KEY`
  em env; leitura cai pro `.env` legado enquanto a chave não estiver no banco.
- Backup = **JSON único**, todas as tabelas. Segredos vão no JSON **como estão
  (blob criptografado)** — restauração exige a mesma `APP_ENCRYPTION_KEY`.
- Backup tem **exportar + importar**. Importar = **restauração total**
  (apaga tudo e regrava), com confirmação dupla na UI.
- **Cron diário** de backup pro S3 desde já, retenção padrão 30.
- Anexos ao ligar S3: **dual-read** — novos vão pro S3, antigos continuam
  lidos do disco. Sem job de migração.
- Logo/nome/cor aparecem em: cabeçalho app+portal, telas de login, e-mails,
  `<title>` + favicon (favicon = a própria imagem do logo).
- Imagem do logo guardada **no storage de anexos** (segue a config disk/S3),
  servida por endpoint público de branding.

## 3. Arquitetura

### 3.1 Backend — módulos novos

```
backend/src/
  settings/
    settings.module.ts
    settings.service.ts        # store chave→valor, cache, cripto, fallback env
    settings.controller.ts     # GET/PUT /settings, POST /settings/storage/test  (ADMIN)
    crypto.util.ts             # AES-256-GCM encrypt/decrypt (crypto nativo)
    settings.keys.ts           # catálogo de chaves + mapa chave→env legado
  storage/
    storage.module.ts
    storage.service.ts         # put/get/readable/delete/exists + resolução de driver
    disk.driver.ts
    s3.driver.ts               # @aws-sdk/client-s3
  branding/
    branding.module.ts
    branding.controller.ts     # GET /branding, GET /branding/logo  (@Public)
  backup/
    backup.module.ts
    backup.service.ts          # export(): objeto; import(json): restauração total
    backup.controller.ts       # GET /backup/export, POST /backup/import, GET /backup/list  (ADMIN)
    backup.cron.ts             # @Cron diário → storage backups/ + poda
```

### 3.2 `SettingsService`

Tabela nova `Setting`:

```prisma
model Setting {
  key       String   @id
  value     String            // texto puro OU blob "v1:<iv>:<tag>:<ct>" (base64)
  encrypted Boolean  @default(false)
  updatedAt DateTime @updatedAt
  @@map("settings")
}
```

API:

- `get(key): Promise<string | undefined>` — valor do banco; se ausente, lê
  `process.env[ENV_MAP[key]]`. Descriptografa se `encrypted`.
- `getBool(key)`, `getJson<T>(key)` — açúcar em cima de `get`.
- `getMany(keys)` — batch pra montar config de um consumidor.
- `set(key, value, { encrypt })` — upsert. `encrypt: true` grava blob GCM.
  String vazia em `set` de segredo = **no-op** (não apaga o que já existe).
- `unset(key)` — remove a linha (volta pro fallback de env).
- Cache em memória (`Map`), invalidado a cada `set`/`unset`. Instância única
  (mesma premissa do resto do MVP) — sem pub/sub.

`crypto.util.ts`:

- `encrypt(plain: string): string` → `v1:<ivB64>:<tagB64>:<ctB64>`.
- `decrypt(blob: string): string` — valida a tag GCM (erro se adulterado).
- Chave: `APP_ENCRYPTION_KEY` (base64 de 32 bytes). Ausente + escrita de
  segredo → `500` com mensagem clara. Ausente + leitura de segredo → cai pro
  fallback de env (permite subir sem a chave até o admin configurar).
- Self-check: `demo()` com round-trip + adulteração da tag.

`settings.keys.ts` — catálogo (chave, se é segredo, env legado):

| Chave | Segredo | Env legado |
|---|---|---|
| `resend.apiKey` | sim | `RESEND_API_KEY` |
| `mail.from` | não | `MAIL_FROM` |
| `resend.inboundSecret` | sim | `RESEND_INBOUND_SECRET` |
| `storage.driver` | não | — (`disk` default) |
| `storage.s3.endpoint` | não | — |
| `storage.s3.region` | não | — |
| `storage.s3.bucket` | não | — |
| `storage.s3.accessKeyId` | sim | — |
| `storage.s3.secretAccessKey` | sim | — |
| `storage.s3.forcePathStyle` | não | — (`false`) |
| `storage.s3.publicBaseUrl` | não | — |
| `storage.s3.prefix` | não | — (`''`) |
| `backup.s3.enabled` | não | — (`false`) |
| `backup.retention` | não | — (`30`) |
| `branding.companyName` | não | — |
| `branding.primaryColor` | não | — |
| `branding.logoKey` | não | — (setada pelo upload) |

### 3.3 `StorageService`

Abstração mínima com dois drivers. Driver ativo resolvido de
`settings.get('storage.driver')` a cada operação (cache do SettingsService
absorve o custo).

```ts
interface StorageDriver {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  readable(key: string): Promise<{ stream: Readable; mime?: string; size?: number }>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}
```

- `DiskStorageDriver` — `STORAGE_PATH` (env, default `./uploads`). `key`
  relativo; caminho absoluto legado (linhas antigas de `Attachment`) é aceito
  direto em `readable`.
- `S3StorageDriver` — `@aws-sdk/client-s3`. `endpoint` + `forcePathStyle` pra
  R2/MinIO. `key` real = `${prefix}${key}`.
- **Dual-read**: `StorageService.readable(key)` — se `key` é caminho absoluto
  (começa com `/`, `\` ou `C:\`-like) OU existe no disco → lê do disco;
  senão → driver ativo. Cobre anexos gravados antes do S3 sem migração.
- `@aws-sdk/s3-request-presigner` só se formos servir anexo por URL assinada;
  no MVP o download continua passando pelo backend (stream), então **não**
  adicionamos o presigner agora.

Dependências novas: `@aws-sdk/client-s3`. (SigV4 na mão é caminho de
segurança — não reimplementar.)

### 3.4 Consumidores alterados

- **`EmailService`** — injeta `SettingsService`. `apiKey`/`from` vêm de
  `getMany(['resend.apiKey','mail.from'])`. Sem chave (banco e env) → mesmo
  no-op logado de hoje. Client Resend deixa de ser memoizado no construtor:
  memoiza por `apiKey` (recria se a chave mudar).
- **Templates de e-mail** (`templates.ts`) — `wrap()` ganha um cabeçalho
  opcional com `<img src="${APP_URL}/api/branding/logo">` e rodapé com o nome
  da empresa. `EmailService.send` injeta `{ companyName, logoUrl }` lidos do
  `SettingsService`/`branding` e repassa aos templates. `APP_URL` continua em
  env (já usado em `users.service`).
- **`InboundController.verifyResendSignature`** — deixa de ser função de
  módulo lendo `process.env`; vira método que recebe o secret de
  `settings.getSecret('resend.inboundSecret')`. Handler já é `async`.
- **`AttachmentsService`** — injeta `StorageService`. `persist()` grava via
  `storage.put('attachments/<uuid><ext>', buf, mime)` e salva
  `storedPath = 'attachments/<uuid><ext>'` (uma **key**, não caminho).
  `AttachmentsController.download` troca `res.download(path)` por stream de
  `storage.readable(attachment.storedPath)` + `Content-Disposition` montado à
  mão (RFC 5987, já que perdemos o helper do Express) — reaproveita lógica de
  `storedName`/`safeExt`. `onModuleInit` só faz `mkdir` quando driver = disk.

### 3.5 `BrandingController` (`@Public`)

- `GET /api/branding` → `{ companyName, primaryColor, logoUrl, hasLogo }`.
  `logoUrl` = `/api/branding/logo` (sempre same-origin; o front nunca fala com
  o S3 direto).
- `GET /api/branding/logo` → stream de `storage.readable(branding.logoKey)`,
  `Cache-Control: public, max-age=300`. 404 se não houver logo.
- Upload do logo: `POST /api/settings/branding/logo` (ADMIN, multipart),
  valida mime imagem + tamanho (≤ 2 MB), grava
  `storage.put('branding/logo<ext>', ...)`, seta `branding.logoKey`.
  `DELETE` remove.

### 3.6 `BackupService`

- `export(): Promise<BackupFile>` — lê cada model do Prisma
  (`users, clients, categories, slaPolicy, tickets, ticketComments,
  ticketEvents, attachments, inboundEmails, counters, settings`) em um
  objeto (`refreshTokens` fica de fora):

  ```json
  { "meta": { "version": 1, "exportedAt": "...", "appVersion": "0.1.1" },
    "data": { "users": [...], "tickets": [...], ... } }
  ```

  `refreshTokens` **fora** (sessões não se restauram). Anexos: só metadados
  (os binários já estão no storage/S3). Segredos de `settings`: exportados
  como estão (blob criptografado).

- `import(file): Promise<void>` — **restauração total**, em transação:
  1. valida `meta.version === 1` e shape.
  2. `deleteMany` em todas as tabelas na ordem reversa de FK.
  3. `createMany` na ordem direta de FK.
  4. ajusta a sequência de `counters`.
  - Exige `confirm: "RESTAURAR"` no corpo. Loga quem disparou.
  - Aviso na doc/UI: se o usuário logado não existir no backup, ele perde o
    acesso (comportamento esperado de "restaurar em servidor novo").

- `GET /api/backup/export` — `Content-Disposition: attachment;
  filename="os-backup-<ISO>.json"`, `application/json`. Stream do
  `JSON.stringify` (dataset do MVP cabe em memória; `ponytail:` comenta o teto
  e a saída — trocar por streaming se passar de ~100 MB).
- `POST /api/backup/import` — multipart (`file`) + `confirm`.
- `GET /api/backup/list` — lista `storage.list('backups/')` (nome + tamanho),
  pros backups do cron.

### 3.7 `BackupCron`

```ts
@Cron('0 3 * * *')  // 03:00 diário
async run() {
  if (!(await settings.getBool('backup.s3.enabled'))) return;
  const json = JSON.stringify(await backup.export());
  const name = `backups/os-backup-${new Date().toISOString()}.json`;
  await storage.put(name, Buffer.from(json), 'application/json');
  // poda: mantém os N mais recentes por nome (ISO ordena lexicograficamente)
  const keep = await settings.getJson<number>('backup.retention') ?? 30;
  const all = (await storage.list('backups/')).sort().reverse();
  for (const old of all.slice(keep)) await storage.delete(old);
}
```

Registrado em `TasksModule` (já existe, já importa `@nestjs/schedule`).
`ponytail:` sem lock — instância única, igual ao `SlaBreachCron`.

### 3.8 Frontend

- **`lib/branding.ts`** — `getBranding()` (fetch `/api/branding`, sem auth).
- **`app/layout.tsx` (root)** — vira Server Component que faz `getBranding()`
  e injeta:
  - `<title>` = `companyName ?? 'Sistema de OS'`.
  - `<link rel="icon" href="/api/branding/logo">` quando `hasLogo`.
  - `<style>:root{--primary:<primaryColor>}` inline quando setada (sobrescreve
    o token do `globals.css`).
  - `metadata` estática de hoje sai; `generateMetadata()` entra.
- **`components/nav.tsx` (AppNav)** e header do portal — renderizam
  `<img src="/api/branding/logo">` + `companyName`. Fallback: texto
  "Sistema de OS" quando não há logo.
- **Telas de login** (`/app/login`, `/portal/login`) — logo + nome no topo.
  Client components; buscam branding via `useQuery(['branding'])`.
- **`app/config/page.tsx`** — 4 abas novas, visíveis só se
  `session.user.role === 'ADMIN'`:
  - **E-mail** — form: chave Resend (password, placeholder "•••• configurado"
    quando já há), remetente, segredo inbound. Botão "Enviar e-mail de teste".
  - **Armazenamento** — select disk/S3; campos S3; botão "Testar conexão"
    (`POST /settings/storage/test` faz um `put`+`delete` de um objeto sonda).
  - **Backup** — botão "Baixar backup agora"; upload + campo "digite RESTAURAR"
    + botão "Importar"; toggle "backup diário pro S3" + retenção; lista dos
    últimos backups do cron.
  - **Aparência** — nome da empresa; upload de logo (preview); color picker de
    cor primária; botão salvar.
  - Endpoints: `GET /settings` (valores não-segredos + flags `xxxSet:boolean`),
    `PUT /settings` (bulk; segredo vazio = ignora).

### 3.9 Schema / migração

- Única mudança de schema: model `Setting`. `npx prisma migrate dev --name
  settings`.
- `Attachment.storedPath` muda de semântica (key em vez de caminho) para
  linhas novas; coluna intacta; dual-read cobre as antigas.
- Env novo: `APP_ENCRYPTION_KEY` (obrigatório pra gravar segredo).
  `deploy/stack.env.example` + README documentam
  `openssl rand -base64 32`. `RESEND_*`, `MAIL_FROM`, `STORAGE_PATH`,
  `APP_URL` seguem como fallback (documentar como "legado / opcional").

## 4. Fluxos

### 4.1 Admin configura o Resend
`PUT /settings {resend.apiKey, mail.from}` → `SettingsService.set` grava
`resend.apiKey` como blob GCM, `mail.from` texto puro → cache invalida →
próximo `EmailService.send` lê do banco. Env legado ignorado quando o banco
tem valor.

### 4.2 Admin liga o S3
`PUT /settings {storage.driver:'s3', storage.s3.*}` → "Testar conexão" faz
`put`/`delete` de `__probe`. A partir daí, todo anexo novo vai pro bucket;
downloads de anexos antigos continuam vindo do disco (dual-read). Logo, se já
existia, foi gravado no disco — re-upload pra mandar pro S3 (aceitável;
`ponytail:` documenta).

### 4.3 Backup manual
Botão → `GET /backup/export` → browser baixa `os-backup-<ISO>.json`.

### 4.4 Restauração
Servidor novo, mesma `APP_ENCRYPTION_KEY` → aba Backup → upload + "RESTAURAR"
→ `POST /backup/import` → transação apaga+regrava → admin faz login com as
credenciais do backup.

### 4.5 Backup automático
`backup.s3.enabled=true` → `BackupCron` às 03:00 grava
`backups/os-backup-<ISO>.json` no storage ativo e poda pra `backup.retention`.

## 5. Erros e bordas

- `APP_ENCRYPTION_KEY` ausente: app sobe; leitura de segredo usa env; gravar
  segredo → 500 "defina APP_ENCRYPTION_KEY". `GET /settings` sinaliza o estado.
- S3 mal configurado: `StorageService` propaga o erro do SDK; upload de anexo
  responde 502 "falha ao gravar no armazenamento" (não perde o arquivo
  silenciosamente). "Testar conexão" mostra a mensagem crua.
- Import com `meta.version` diferente ou JSON inválido → 400, nada é apagado
  (validação antes da transação).
- Import parcial (erro no meio) → rollback da transação; estado anterior
  intacto.
- Logo com mime não-imagem ou > 2 MB → 400.
- `branding.primaryColor` inválida (não casa `#[0-9a-fA-F]{3,8}`) → 400.
- Download de anexo cujo objeto sumiu do storage → 404 "arquivo não
  encontrado no armazenamento".

## 6. Testes

Unitários (vitest, sem infra):

- `crypto.util` — round-trip; tag adulterada → erro; sem chave → erro.
- `SettingsService` — fallback pro env; `set` de segredo vazio é no-op; cache
  invalida no `set`; `encrypted` round-trip (com `crypto.util` real).
- `StorageService` + `DiskStorageDriver` — `put`/`readable`/`delete` em
  `tmpdir`; caminho absoluto legado em `readable`.
- `S3StorageDriver` — `vi.mock('@aws-sdk/client-s3')`, assert nos comandos.
- `BackupService.export` — dataset fake do Prisma → objeto com as tabelas
  esperadas, sem `refreshTokens`.
- `BackupService.import` — JSON inválido / versão errada → erro antes de
  qualquer `deleteMany`; ordem de delete/create respeita FK.
- `BackupCron` — `enabled=false` → no-op; poda mantém N; `enabled=true`
  chama `storage.put` 1x.
- `EmailService` — ajustar os testes atuais pra stub de `SettingsService`
  (hoje setam `process.env`); cobrir "banco tem chave, env não".
- `InboundController` — assinatura válida/ inválida com secret vindo do
  `SettingsService`.

Integração (`test:integration`, exige Postgres):

- `BackupService` round-trip: `export` → `import` → dados idênticos.
- `SettingsController` `PUT`/`GET` com cripto real.

## 7. Sequência de implementação (rascunho pro plano)

1. `crypto.util` + testes.
2. `Setting` model + migração + `SettingsService` + testes + fallback env.
3. `SettingsController` (`GET`/`PUT`) + gate ADMIN + testes.
4. `StorageService` + `DiskStorageDriver` + refactor do `AttachmentsService`
   pra usar o storage (comportamento idêntico, driver disk). Testes verdes.
5. `S3StorageDriver` + dep `@aws-sdk/client-s3` + `POST /settings/storage/test`.
6. Migrar `EmailService` + templates + `InboundController` pro `SettingsService`
   (com fallback). Ajustar testes.
7. `BrandingController` público + upload de logo.
8. Frontend: `getBranding` + root layout (title/favicon/cor) + headers + logins.
9. Frontend: abas E-mail / Armazenamento / Aparência na tela de config.
10. `BackupService` (export/import) + `BackupController` + testes.
11. Frontend: aba Backup (download / import / lista).
12. `BackupCron` + toggle no front + retenção.
13. Docs: `stack.env.example`, README (nova env, "config agora no app"),
    CHANGELOG. Bump `0.2.0`.

## 8. Versão

`feat` grande → `0.2.0`. Conventional Commits por passo. CHANGELOG em
"Keep a Changelog". Sem breaking de dados (env vira fallback, não some).
