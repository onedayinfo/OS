# Auditoria e logs — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIO: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos em checkbox (`- [ ]`).

**Objetivo:** registrar ações de escrita dos usuários e `warn`/`error` do backend numa tabela `AuditLog`, consultável por ADMIN em Configurações → Auditoria.

**Arquitetura:** módulo `src/audit/` com `AuditService` (grava/lista/apaga), `AuditInterceptor` global (APP_INTERCEPTOR) para ações, `AuditLogger` (ConsoleLogger estendido, `app.useLogger`) para falhas e `AuditRetentionCron`. Front: aba nova `audit-tab.tsx`.

**Stack:** NestJS 11 (ESM, imports `.js`), Prisma 6/Postgres, vitest; Next.js + React Query + sonner.

**Spec:** `docs/superpowers/specs/2026-11-16-auditoria-logs-design.md`

## Restrições globais
- Execução em `C:/Users/renan/os-exec`, **em worktree/branch `feat/auditoria-logs`** criada a partir de `origin/main` (o checkout principal do os-exec tem trabalho não commitado de outra sessão em `backend/src/agent/*`, `backend/Dockerfile` e `frontend/src/components/client-agent-tab.tsx` — não tocar).
- Primeiro commit da branch: a correção do S3 já feita no Z: (`backend/src/storage/s3.driver.ts`, `backend/src/storage/s3.driver.spec.ts`, `backend/src/settings/settings.controller.ts`) — copiar do Z: para a worktree.
- Nenhuma dependência nova.
- Gravar log de auditoria **nunca** derruba a requisição nem chama o próprio logger (usa `process.stderr.write` no catch).
- Segredos mascarados como `"***"`; corpo gravado limitado a 4096 caracteres de JSON (acima disso: `{ _truncated: true, preview: <primeiros 4096 chars> }`).
- Fora da auditoria de ações (prefixos de `req.originalUrl`): `/api/agent/checkin`, `/api/integrations/events`, `/api/inbound`, `/api/whatsapp/webhook`, `/api/auth/refresh`. Conferir os caminhos reais dos webhooks com `grep -rn "@Controller" src/inbound src/whatsapp` e ajustar a lista.
- Retenção: Setting `audit.retentionDays`, padrão `90`.
- Texto da UI em pt-BR.
- Versão: `0.20.0` em `backend/package.json`, `frontend/package.json` e `CHANGELOG.md`.

## Foco da revisão
1. Campo secreto aninhado ou em array (`{ s3: { secretAccessKey } }`, `values: { 'storage.s3.secretAccessKey': 'x' }` — chave com ponto) → mascarado. Teste na Task 2.
2. Login com senha errada → linha `ACTION` com status 401, `actorLabel` = e-mail, senha mascarada. Teste na Task 3.
3. Banco fora do ar / `auditLog.create` rejeita → requisição do usuário responde normalmente, sem loop de log. Testes nas Tasks 2 e 3.
4. Upload multipart → só `{ name, size, mime }` do arquivo, nunca buffer. Teste na Task 3.
5. `AuditLogger.error` chamado com `Error` em vez de string (Nest faz isso em exceções não tratadas) → `message` legível e `stack` em `data`. Teste na Task 4.

---

### Task 1: Worktree, correção S3 e modelo `AuditLog`

**Arquivos:**
- Modificar: `backend/prisma/schema.prisma` (model novo + relação em `User`)
- Criar: `backend/prisma/migrations/20261116200000_audit_logs/migration.sql` (gerar com `npx prisma migrate dev --name audit_logs --create-only` e renomear a pasta com esse timestamp se preciso)
- Modificar: `backend/src/settings/settings.keys.ts` (adicionar `'audit.retentionDays'` a `SETTING_KEYS`)

- [ ] **Passo 1:** `git -C C:/Users/renan/os-exec fetch && git -C C:/Users/renan/os-exec worktree add ../os-audit -b feat/auditoria-logs origin/main`; `npm ci` em `backend` e `frontend` da worktree.
- [ ] **Passo 2:** copiar os 3 arquivos da correção S3 do Z:, rodar `npx vitest run src/storage src/settings` (esperado: PASS), commit `fix(storage): mensagem detalhada e log no teste de conexão S3`.
- [ ] **Passo 3:** model:

```prisma
enum AuditKind { ACTION ERROR }

model AuditLog {
  id         String    @id @default(cuid())
  createdAt  DateTime  @default(now())
  kind       AuditKind
  level      String    // info | warn | error
  actorId    String?
  actorLabel String?
  ip         String?
  method     String?
  path       String?
  status     Int?
  module     String
  message    String
  data       Json?
  actor      User?     @relation(fields: [actorId], references: [id], onDelete: SetNull)

  @@index([createdAt])
  @@index([kind, createdAt])
  @@index([actorId])
  @@map("audit_logs")
}
```
`User` ganha `auditLogs AuditLog[]`.
- [ ] **Passo 4:** gerar migração, `npx prisma generate`, `npx tsc --noEmit -p .` sem erros novos (há erros antigos em `quotes.service.spec.ts`, `tickets.service.spec.ts`, `test/app.e2e-spec.ts` — ignorar).
- [ ] **Passo 5:** commit `feat(audit): tabela audit_logs`.

### Task 2: `AuditService` + mascaramento

**Arquivos:**
- Criar: `backend/src/audit/redact.ts`, `backend/src/audit/redact.spec.ts`
- Criar: `backend/src/audit/audit.service.ts`, `backend/src/audit/audit.service.spec.ts`
- Criar: `backend/src/audit/audit.module.ts` (`@Global()`, provê e exporta `AuditService`; registrado em `app.module.ts` logo após `SettingsModule`)

**Interfaces (produz):**
- `redact(value: unknown): unknown` — cópia profunda; chave cujo nome em minúsculas contém `password`, `secret`, `token`, `apikey`, `authorization`, ou termina em `key` (ex.: `accessKeyId` NÃO termina em `key` → manter; `'storage.s3.secretAccessKey'` contém `secret` → mascarar; `apiKey`, `resend.apiKey` → mascarar) → `'***'`. Buffers → `'[binary]'`.
- `limitSize(value: unknown, max = 4096): unknown`
- `type AuditEntry = { kind: 'ACTION' | 'ERROR'; level: 'info' | 'warn' | 'error'; module: string; message: string; actorId?: string | null; actorLabel?: string | null; ip?: string | null; method?: string; path?: string; status?: number; data?: unknown }`
- `AuditService.record(e: AuditEntry): void` — fire-and-forget: `prisma.auditLog.create(...).catch(err => process.stderr.write(...))`. Aplica `limitSize(redact(data))`.
- `AuditService.list(q: AuditQueryDto): Promise<{ data: AuditLog & { actor: { name: string; email: string } | null }[]; total; page; pageSize }>` — filtros `kind`, `actorId`, `module` (igualdade), `from`/`to` (ISO, em `createdAt`), `q` (`contains`, insensitive, em `message` OU `path`); ordem `createdAt desc`.
- `AuditService.purgeOlderThan(days: number): Promise<number>` — `deleteMany` com `createdAt < now - days`; devolve `count`.
- `AuditQueryDto extends PaginationDto` em `backend/src/audit/dto/audit-query.dto.ts` com `kind?` (`IsIn(['ACTION','ERROR'])`), `actorId?`, `module?`, `from?`/`to?` (`IsISO8601`).

- [ ] **Passo 1: testes que falham** (`redact.spec.ts`):
```ts
expect(redact({ email: 'a@b', password: 'x' })).toEqual({ email: 'a@b', password: '***' });
expect(redact({ values: { 'storage.s3.secretAccessKey': 's', 'storage.s3.accessKeyId': 'AK', 'resend.apiKey': 'k' } }))
  .toEqual({ values: { 'storage.s3.secretAccessKey': '***', 'storage.s3.accessKeyId': 'AK', 'resend.apiKey': '***' } });
expect(redact([{ token: 't' }])).toEqual([{ token: '***' }]);
expect(redact({ f: Buffer.from('x') })).toEqual({ f: '[binary]' });
expect(limitSize({ s: 'x'.repeat(5000) })).toMatchObject({ _truncated: true });
```
`audit.service.spec.ts` (prisma mockado): `record` chama `auditLog.create` com `data` já mascarado; `record` com `create` rejeitando não lança e não chama `Logger`; `list({ kind:'ERROR', q:'s3', page:2, pageSize:10 })` monta `where` com `kind` e `OR` em `message/path` e `skip: 10`; `purgeOlderThan(90)` chama `deleteMany` com `createdAt.lt` ≈ agora − 90 dias.
- [ ] **Passo 2:** `npx vitest run src/audit` → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npx vitest run src/audit` → PASS.
- [ ] **Passo 5:** commit `feat(audit): serviço de auditoria com mascaramento`.

### Task 3: `AuditInterceptor` (ações)

**Arquivos:**
- Criar: `backend/src/audit/audit.interceptor.ts`, `backend/src/audit/audit.interceptor.spec.ts`
- Modificar: `backend/src/audit/audit.module.ts` (`{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }`)

**Interfaces:** consome `AuditService.record`, `CurrentUserData` (`req.user`: `{ id, type, role, clientId }`).

Comportamento: ignora métodos fora de `POST/PUT/PATCH/DELETE` e os prefixos excluídos (Restrições globais). Após a resposta (`tap` no sucesso com `res.statusCode`; `catchError` com `err.getStatus?.() ?? 500`, relançando o erro), chama `record` com `kind:'ACTION'`, `level` = `info` (<400) / `warn` (4xx) / `error` (5xx), `module` = 3º segmento de `originalUrl` sem query (`/api/clients/abc` → `clients`), `message` = `` `${method} ${path}` ``, `actorId` = `req.user?.id ?? null`, `actorLabel` = `req.body?.email` só quando não há `req.user`, `ip` = `req.ip`, `data` = `{ body, files }` onde `files` = `req.file`/`req.files` mapeados para `{ name: originalname, size, mime: mimetype }`.

- [ ] **Passo 1: testes que falham** (contexto/handler fakes com `of()`/`throwError()`):
  - `GET` → `record` não chamado.
  - `PUT /api/clients/abc?x=1` com `req.user.id='u1'` → `record` com `{ kind:'ACTION', level:'info', module:'clients', path:'/api/clients/abc', status:200, actorId:'u1' }`.
  - `POST /api/auth/login` lançando `UnauthorizedException`, body `{ email:'a@b', password:'x' }` → erro relançado; `record` com `status:401`, `level:'warn'`, `actorLabel:'a@b'`, `actorId:null`.
  - `POST /api/agent/checkin` → não registra.
  - `req.file = { originalname:'a.pdf', size:10, mimetype:'application/pdf', buffer }` → `data.files` = `[{ name:'a.pdf', size:10, mime:'application/pdf' }]`, sem `buffer`.
  - `record` lançando → resposta do handler ainda emitida.
- [ ] **Passo 2:** `npx vitest run src/audit/audit.interceptor.spec.ts` → FAIL.
- [ ] **Passo 3:** implementar (envolver `record` em `try/catch`).
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(audit): interceptor global de ações`.

### Task 4: `AuditLogger` (falhas) e retenção

**Arquivos:**
- Criar: `backend/src/audit/audit.logger.ts`, `backend/src/audit/audit.logger.spec.ts`
- Criar: `backend/src/audit/audit-retention.cron.ts`, `backend/src/audit/audit-retention.cron.spec.ts`
- Modificar: `backend/src/audit/audit.module.ts` (providers `AuditLogger`, `AuditRetentionCron`; exporta `AuditLogger`)
- Modificar: `backend/src/main.ts` — `NestFactory.create(..., { rawBody: true, bodyParser: false, bufferLogs: true })` e logo depois `app.useLogger(app.get(AuditLogger))`.

**Interfaces:**
- `@Injectable() class AuditLogger extends ConsoleLogger` com construtor `(audit: AuditService)`; sobrescreve `warn(message: unknown, ...rest: unknown[])` e `error(message: unknown, ...rest: unknown[])`: chama `super`, depois `audit.record({ kind:'ERROR', level, module: <contexto = último string de rest, ou 'app'>, message: message instanceof Error ? message.message : String(message), data: { stack } })`. `stack` = `message.stack` se `Error`, senão o primeiro `rest` string com quebra de linha (padrão do Nest `error(msg, stack, context)`). Logs com contexto `AuditService` são ignorados (anti-recursão).
- `AuditRetentionCron.run(): Promise<void>` com `@Cron('30 3 * * *')`: lê `settings.get('audit.retentionDays')`, `Number(...)`, inválido/≤0 → 90; chama `purgeOlderThan`; loga `Auditoria: N registros antigos apagados.` via `Logger` (`log`, não `warn`).

- [ ] **Passo 1: testes que falham:**
  - `logger.warn('falhou s3', 'SettingsController')` → `record` com `{ kind:'ERROR', level:'warn', module:'SettingsController', message:'falhou s3' }`.
  - `logger.error(new Error('boom'))` → `message:'boom'`, `data.stack` contém `'boom'`, `module:'app'`.
  - `logger.error('x', 'stack\nlinha', 'TicketsService')` → `module:'TicketsService'`, `data.stack:'stack\nlinha'`.
  - `logger.log('ok')` → `record` não chamado.
  - cron com setting `null` → `purgeOlderThan(90)`; com `'30'` → `purgeOlderThan(30)`; com `'abc'` → 90.
- [ ] **Passo 2:** → FAIL. **Passo 3:** implementar. **Passo 4:** `npx vitest run src/audit` → PASS.
- [ ] **Passo 5:** subir backend local (`npm run start:dev` com Postgres dev), fazer um `PUT` qualquer autenticado e um `POST /api/settings/storage/test` com S3 inválido; conferir `select kind, module, message from audit_logs order by "createdAt" desc limit 5;` → linhas `ACTION` e `ERROR` (SettingsController).
- [ ] **Passo 6:** commit `feat(audit): logger persistente e retenção`.

### Task 5: API `GET /api/audit`

**Arquivos:**
- Criar: `backend/src/audit/audit.controller.ts`, `backend/src/audit/audit.controller.spec.ts`
- Modificar: `backend/src/audit/audit.module.ts` (controllers)

**Interfaces:** `@Controller('audit') @Roles('ADMIN')`; `@Get() list(@Query() q: AuditQueryDto)` → `AuditService.list(q)`; `@Get('modules') modules(): Promise<string[]>` → `distinct` de `module` ordenado (para o filtro do front, via `AuditService.modules()`).

- [ ] **Passo 1:** teste: controller repassa a query ao serviço; metadado `roles` do controller = `['ADMIN']` (`Reflect.getMetadata`, seguir o padrão de `roles.guard.spec.ts`).
- [ ] **Passo 2–4:** FAIL → implementar → PASS.
- [ ] **Passo 5:** commit `feat(audit): endpoint de consulta`.

### Task 6: Aba Auditoria no front

**Arquivos:**
- Criar: `frontend/src/app/app/config/tabs/audit-tab.tsx`
- Modificar: `frontend/src/app/app/config/page.tsx` (import; `{ value: 'auditoria', label: 'Auditoria' }` no fim da lista admin; `{tab === 'auditoria' && isAdmin && <AuditTab />}`)

Conteúdo (seguir `storage-tab.tsx`/`backup-tab.tsx`: `useQuery` + `api`, componentes de `@/components/ui`):
- Filtros: Tipo (`Todos` / `Ações` / `Falhas`), Módulo (`Select` de `/audit/modules`), De/Até (`<input type="date">`), busca texto (`q`). Usuário: fora do MVP da tela (a API aceita `actorId`).
- Tabela: Data (`toLocaleString('pt-BR')`), Tipo (Badge: Ação / Falha; cor por `level`), Usuário (`actor?.name ?? actorLabel ?? '—'`), Módulo, Ação/mensagem, Status.
- Clique na linha → `Dialog` com `message`, `path`, `ip` e `<pre>` do `JSON.stringify(data, null, 2)`.
- Paginação "Anterior/Próxima" com `page`/`pageSize=50`.
- Cartão "Retenção": `Input type="number"` ligado a `audit.retentionDays` (GET/PUT `/settings`, mesmo padrão do `storage-tab.tsx`), texto "Registros mais antigos que N dias são apagados todo dia às 03:30."
- Vazio: "Nenhum registro encontrado."

- [ ] **Passo 1:** implementar. **Passo 2:** `npx tsc --noEmit` e `npm run lint` no frontend sem erros novos.
- [ ] **Passo 3:** abrir `/app/config` → aba Auditoria com backend local; conferir as linhas geradas na Task 4 e o detalhe.
- [ ] **Passo 4:** commit `feat(frontend): aba Auditoria em Configurações`.

### Task 7: Versão e changelog

- [ ] **Passo 1:** `0.20.0` nos dois `package.json` (+ `package-lock.json` via `npm version 0.20.0 --no-git-tag-version`); `CHANGELOG.md` seção `## [0.20.0] - 2026-11-16` com: auditoria de ações, registro de falhas, aba Auditoria, retenção configurável, mensagem detalhada no teste de S3.
- [ ] **Passo 2:** `npx vitest run` completo no backend → PASS (sem regressões).
- [ ] **Passo 3:** commit `docs: CHANGELOG 0.20.0 (auditoria e logs)`.
