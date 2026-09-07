# Sistema de OS — Plano de Implementação

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Goal:** Entregar um sistema de chamados/OS para empresa de informática, com abertura por e-mail, portal do cliente e criação manual, rodando em Docker.

**Architecture:** Monorepo com backend NestJS + Prisma + Postgres e frontend Next.js (App Router). Um único registro de domínio (`Ticket`). Autenticação JWT access/refresh. E-mail de entrada e saída via Resend. Sem Redis: cron via `@nestjs/schedule`. Single-tenant.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Next.js 14 (App Router), Tailwind, shadcn/ui, TanStack Query, react-hook-form + zod, Jest, Playwright, Docker Compose, Resend SDK.

**Spec:** `docs/superpowers/specs/2026-09-07-sistema-os-design.md`

## Global Constraints

- Toda comunicação, UI, textos de commit e CHANGELOG em **português do Brasil**.
- Modo **Ponytail**: solução mais enxuta que funcione; sem abstração não pedida; stdlib/plataforma antes de dependência nova.
- **SemVer**; `CHANGELOG.md` no formato *Keep a Changelog*; primeira versão `0.1.0`; **Conventional Commits** (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`).
- Sem repositório git ainda — os commits deste plano são preparados; o usuário criará o repo depois. **Antes da Task 1, rodar `git init` local** para os passos de commit funcionarem.
- Só Postgres na stack. Sem Redis, sem SSO, sem magic link, sem dark mode, sem multi-idioma no MVP.
- Anexos gravados em disco (`STORAGE_PATH`), volume Docker.
- Testes só onde há lógica (numeração, SLA, transições, inbound, visibilidade). CRUD trivial não precisa de teste dedicado.
- Enums Prisma exatos: `UserType {INTERNAL, CLIENT}`, `UserRole {ADMIN, AGENT, MANAGER, CONTACT}`, `TicketStatus {OPEN, IN_PROGRESS, WAITING_CLIENT, RESOLVED, CLOSED, CANCELLED}`, `TicketPriority {LOW, MEDIUM, HIGH, URGENT}`, `TicketOrigin {EMAIL, PORTAL, MANUAL}`, `CommentVisibility {INTERNAL, PUBLIC}`, `TicketEventType {CREATED, STATUS_CHANGED, ASSIGNED, PRIORITY_CHANGED, COMMENT, EMAIL_IN, EMAIL_OUT}`.
- Seed de `SlaPolicy`: `URGENT=4, HIGH=8, MEDIUM=24, LOW=72` (horas).
- Número do chamado: `AAAA-NNNN`, 4 dígitos, contador anual transacional, sem reset no meio do ano.

---

## Estrutura de arquivos

### Backend (`backend/`)
| Arquivo | Responsabilidade |
|---|---|
| `prisma/schema.prisma` | Modelo de dados completo |
| `prisma/seed.ts` | Seed: admin inicial, SlaPolicy, categorias exemplo |
| `src/main.ts` | Bootstrap Nest, CORS, `ValidationPipe` global, prefixo `/api` |
| `src/app.module.ts` | Wire de todos os módulos + `ScheduleModule` |
| `src/prisma/prisma.service.ts` | `PrismaClient` como provider |
| `src/common/` | `RolesGuard`, `@Roles`, `@CurrentUser`, filtro de exceção, DTO de paginação |
| `src/auth/` | login, refresh, logout, `JwtStrategy`, hashing |
| `src/users/` | usuários internos + contatos de cliente + fluxo de convite |
| `src/clients/` | CRUD de empresas atendidas |
| `src/categories/` | CRUD de categorias |
| `src/sla/` | `SlaPolicy` CRUD + `SlaService.dueAt(priority, from)` |
| `src/tickets/` | CRUD, numeração, transições, timeline, visibilidade |
| `src/comments/` | andamentos interno/público + `firstResponseAt` |
| `src/attachments/` | upload disco + download com checagem de acesso |
| `src/email/` | `EmailService` (Resend) + templates HTML |
| `src/notifications/` | `NotificationsService` — dispara e-mail por evento |
| `src/inbound/` | webhook Resend: validação, dedupe, threading, triagem |
| `src/tasks/sla-breach.cron.ts` | cron 15 min — e-mail de SLA vencido |

### Frontend (`frontend/`)
| Arquivo | Responsabilidade |
|---|---|
| `src/lib/api.ts` | fetch wrapper com refresh automático |
| `src/lib/auth.tsx` | contexto de sessão, `useSession` |
| `src/components/ui/*` | componentes shadcn/ui |
| `src/app/(app)/...` | telas da equipe |
| `src/app/(portal)/...` | telas do cliente |

### Raiz
`docker-compose.yml`, `docker-compose.dev.yml`, `.env.example`, `CHANGELOG.md`, `README.md`.

---

## Fase 0 — Scaffold e infra

### Task 0.1: Raiz do monorepo + CHANGELOG + git

**Files:**
- Create: `.gitignore`, `CHANGELOG.md`, `README.md`, `.env.example`

**Interfaces:**
- Produces: `.env.example` com as chaves `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `RESEND_API_KEY`, `RESEND_INBOUND_SECRET`, `APP_URL`, `PORTAL_URL`, `MAIL_FROM`, `STORAGE_PATH`, `PORT`.

- [ ] **Step 1: `git init`**

```bash
cd Z:/Projetos/OS && git init
```

- [ ] **Step 2: Criar `.gitignore`**

```
node_modules/
dist/
.next/
.env
uploads/
*.log
```

- [ ] **Step 3: Criar `CHANGELOG.md`**

```markdown
# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Estrutura inicial do monorepo.
```

- [ ] **Step 4: Criar `README.md`** com pré-requisitos (Node 20, Docker), `docker compose -f docker-compose.dev.yml up`, e URL local `http://localhost:3000`.

- [ ] **Step 5: Criar `.env.example`** com as chaves listadas em Interfaces, valores de exemplo, e comentário de que `suporte@<dominio>` é o `MAIL_FROM`.

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "chore: estrutura inicial do monorepo e changelog"
```

### Task 0.2: Backend NestJS scaffold

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/nest-cli.json`, `backend/src/main.ts`, `backend/src/app.module.ts`, `backend/.env`
- Create: `backend/src/prisma/prisma.service.ts`, `backend/src/prisma/prisma.module.ts`

**Interfaces:**
- Produces: `PrismaService extends PrismaClient` (global module); `main.ts` sobe em `PORT` (default 3001), prefixo global `/api`, `ValidationPipe({ whitelist: true, transform: true })`, CORS liberado para `APP_URL` e `PORTAL_URL`.

- [ ] **Step 1: Scaffold**

```bash
cd backend && npx @nestjs/cli new . --skip-git --package-manager npm
npm i @prisma/client @nestjs/config @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt class-validator class-transformer @nestjs/schedule resend
npm i -D prisma @types/passport-jwt @types/bcrypt
```

- [ ] **Step 2: `PrismaService`**

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect(); }
}
```

`PrismaModule` marca `@Global()` e exporta `PrismaService`.

- [ ] **Step 3: `main.ts`** com prefixo `/api`, `ValidationPipe`, CORS, `app.listen(process.env.PORT ?? 3001)`.

- [ ] **Step 4: `app.module.ts`** importa `ConfigModule.forRoot({ isGlobal: true })`, `ScheduleModule.forRoot()`, `PrismaModule`.

- [ ] **Step 5: Rodar `npm run start:dev`**, confirmar log "Nest application successfully started".

- [ ] **Step 6: Commit**

```bash
git add backend && git commit -m "chore(backend): scaffold NestJS + Prisma"
```

### Task 0.3: Frontend Next.js scaffold

**Files:**
- Create: `frontend/` (create-next-app), `frontend/.env.local`

**Interfaces:**
- Produces: app Next 14 App Router + TS + Tailwind; `NEXT_PUBLIC_API_URL` aponta para `http://localhost:3001/api`.

- [ ] **Step 1: Scaffold**

```bash
npx create-next-app@14 frontend --ts --tailwind --app --src-dir --no-eslint --import-alias "@/*"
cd frontend && npx shadcn@latest init -d
npm i @tanstack/react-query react-hook-form zod @hookform/resolvers
```

- [ ] **Step 2:** adicionar componentes base: `npx shadcn@latest add button input table dialog select badge textarea sonner card tabs dropdown-menu`.

- [ ] **Step 3:** `frontend/.env.local` com `NEXT_PUBLIC_API_URL=http://localhost:3001/api`.

- [ ] **Step 4:** rodar `npm run dev`, abrir `http://localhost:3000`, confirmar página inicial.

- [ ] **Step 5: Commit**

```bash
git add frontend && git commit -m "chore(frontend): scaffold Next.js + shadcn/ui"
```

### Task 0.4: Docker Compose

**Files:**
- Create: `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`

**Interfaces:**
- Consumes: envs da Task 0.1.
- Produces: serviços `postgres` (16-alpine, volume `pg_data`, `127.0.0.1:5432`), `backend` (porta 3001, volume `uploads:/app/uploads`, roda `prisma migrate deploy` no start), `frontend` (porta 3000). Rede `os-net`.

- [ ] **Step 1: `backend/Dockerfile`** multi-stage (builder instala + `prisma generate` + build; runner copia `dist`, `node_modules`, `prisma`; CMD `sh -c "npx prisma migrate deploy && node dist/main.js"`).

- [ ] **Step 2: `frontend/Dockerfile`** multi-stage Next standalone.

- [ ] **Step 3: `docker-compose.yml`** (produção) com os 3 serviços, healthcheck do postgres, `depends_on`.

- [ ] **Step 4: `docker-compose.dev.yml`** — override: `build.target: builder`, volumes de código, `command` de hot reload, portas expostas.

- [ ] **Step 5:** `docker compose -f docker-compose.yml -f docker-compose.dev.yml config` valida sem erro.

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "chore: docker compose para dev e produção"
```

---

## Fase 1 — Modelo de dados

### Task 1.1: Schema Prisma completo

**Files:**
- Create/Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/seed.ts`, `backend/package.json` (campo `prisma.seed`)

**Interfaces:**
- Produces: models `User, Client, Category, SlaPolicy, Ticket, TicketComment, TicketEvent, Attachment, InboundEmail, RefreshToken, Counter` conforme §4 do spec, com os enums das Global Constraints.

- [ ] **Step 1: Escrever `schema.prisma`** — datasource postgres, generator client. Todos os models e enums exatamente como no spec §4. Pontos de atenção:
  - `Ticket.number String @unique`, `Ticket.clientId String?`, `Ticket.requesterId String?`, `Ticket.needsTriage Boolean @default(false)`.
  - `Counter { year Int @id, value Int @default(0) }`.
  - `Attachment` com `ticketId String?` e `commentId String?` (validação de "exatamente um" fica no service).
  - `RefreshToken { id, userId, tokenHash, expiresAt, revokedAt DateTime?, createdAt }`.
  - `@@map` em snake_case para todas as tabelas.

- [ ] **Step 2: Primeira migration**

```bash
cd backend && npx prisma migrate dev --name init
```

Expected: migration criada, `prisma generate` roda.

- [ ] **Step 3: `seed.ts`** — cria `SlaPolicy` (4 linhas do seed), 4 categorias (`Hardware`, `Rede`, `E-mail`, `Software`), e um `User` ADMIN (`email` de env `SEED_ADMIN_EMAIL`, senha de `SEED_ADMIN_PASSWORD`, `passwordHash` via bcrypt). Idempotente com `upsert`.

- [ ] **Step 4: Rodar seed**

```bash
npx prisma db seed
```

Expected: sem erro; `npx prisma studio` mostra as linhas.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma backend/package.json && git commit -m "feat(backend): schema Prisma e seed inicial"
```

---

## Fase 2 — Autenticação

### Task 2.1: Hash e utilitários de senha

**Files:**
- Create: `backend/src/auth/password.util.ts`
- Test: `backend/src/auth/password.util.spec.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Teste que falha**

```ts
import { hashPassword, verifyPassword } from './password.util';

it('verifica senha correta e rejeita errada', async () => {
  const h = await hashPassword('segredo123');
  expect(await verifyPassword('segredo123', h)).toBe(true);
  expect(await verifyPassword('errada', h)).toBe(false);
});
```

- [ ] **Step 2: Rodar** `npm test -- password.util` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** com `bcrypt.hash(plain, 10)` e `bcrypt.compare`.

- [ ] **Step 4: Rodar** → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(auth): utilitários de senha com bcrypt"`

### Task 2.2: Login, refresh, logout

**Files:**
- Create: `backend/src/auth/auth.service.ts`, `auth.controller.ts`, `auth.module.ts`, `jwt.strategy.ts`, `dto/login.dto.ts`
- Test: `backend/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `hashPassword`/`verifyPassword`.
- Produces:
  - `POST /api/auth/login {email, password}` → `{ accessToken, user: {id,name,email,type,role,clientId} }` + `refreshToken` em cookie httpOnly.
  - `POST /api/auth/refresh` (lê cookie) → `{ accessToken }`, rotaciona o refresh.
  - `POST /api/auth/logout` → revoga o refresh.
  - `JwtStrategy` valida `accessToken` e injeta `req.user = {id,type,role,clientId}`.
  - `AuthService.issueTokens(user)`, `AuthService.rotateRefresh(rawToken)`.

- [ ] **Step 1: Teste que falha** — `AuthService.validateLogin` retorna usuário com senha certa, lança `UnauthorizedException` com senha errada ou usuário inativo/sem hash.

```ts
it('rejeita usuário inativo', async () => {
  prisma.user.findUnique.mockResolvedValue({ ...userAtivoFalse });
  await expect(service.validateLogin('a@a.com', 'x')).rejects.toThrow(UnauthorizedException);
});
```

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar** `AuthService`:
  - `validateLogin`: `findUnique` por email; se `!user || !user.active || !user.passwordHash` → `UnauthorizedException`; `verifyPassword` senão.
  - `issueTokens`: `accessToken` JWT (`sub`, `type`, `role`, `clientId`, exp 15m, `JWT_ACCESS_SECRET`); `refreshToken` = `randomBytes(48).hex`, grava `RefreshToken` com `tokenHash = sha256(raw)`, `expiresAt = +30d`.
  - `rotateRefresh`: acha por hash, valida não revogado/não expirado, revoga o antigo, emite par novo.
  - `logout`: marca `revokedAt`.
  - `JwtStrategy`: `ExtractJwt.fromAuthHeaderAsBearerToken()`, `secretOrKey = JWT_ACCESS_SECRET`, `validate(payload)` → `{ id: payload.sub, type, role, clientId }`.

- [ ] **Step 4: Rodar** → PASS.

- [ ] **Step 5: Teste manual** com `curl` no `login` do admin semeado; confirmar `accessToken` retornado.

- [ ] **Step 6: Commit** `git commit -m "feat(auth): login, refresh rotativo e logout com JWT"`

### Task 2.3: Guard de papéis e decorators

**Files:**
- Create: `backend/src/common/roles.guard.ts`, `roles.decorator.ts`, `current-user.decorator.ts`, `common.module.ts`
- Modify: `backend/src/main.ts` (registrar `JwtAuthGuard` global)
- Test: `backend/src/common/roles.guard.spec.ts`

**Interfaces:**
- Produces:
  - `@Roles(...roles: UserRole[])` — metadata.
  - `RolesGuard` — libera se rota não tem `@Roles`; senão exige `req.user.role ∈ roles`.
  - `@Public()` — pula o `JwtAuthGuard` global.
  - `@CurrentUser()` — retorna `req.user`.

- [ ] **Step 1: Teste que falha** — `RolesGuard.canActivate` retorna `false` para `role=AGENT` numa rota `@Roles('ADMIN')`, `true` sem metadata.

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar** guard com `Reflector.getAllAndOverride`.

- [ ] **Step 4: Rodar** → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(common): RolesGuard, decorators de papel e usuário atual"`

---

## Fase 3 — Cadastros base

### Task 3.1: Clientes (CRUD)

**Files:**
- Create: `backend/src/clients/clients.{service,controller,module}.ts`, `dto/{create,update}-client.dto.ts`
- Test: `backend/src/clients/clients.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `ClientsService.create/findAll(params)/findOne(id)/update(id,dto)/setActive(id,bool)`.
  - Rotas sob `@Roles('ADMIN','AGENT')`: `POST/GET/GET :id/PATCH :id /api/clients`.
  - DTO create: `name (string, req)`, `cnpj?`, `emailDomains (string[], default [])`, `notes?`.
  - `findAll` retorna `{ data, total, page, pageSize }` (usar `PaginationDto` da Task 2.3? não — criar `common/pagination.dto.ts` aqui: `page=1, pageSize=20, q?`).

- [ ] **Step 1: Teste que falha** — `create` normaliza `emailDomains` para lowercase e sem `@`; `findAll` filtra por `q` em `name`.

```ts
it('normaliza domínios', async () => {
  await service.create({ name: 'ACME', emailDomains: ['@ACME.com', 'Acme.com.br'] });
  expect(prisma.client.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ emailDomains: ['acme.com', 'acme.com.br'] }) }),
  );
});
```

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar** service + controller + `common/pagination.dto.ts`.

- [ ] **Step 4: Rodar** → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(clients): CRUD de empresas atendidas"`

### Task 3.2: Categorias (CRUD)

**Files:**
- Create: `backend/src/categories/categories.{service,controller,module}.ts`, `dto/*`
- Test: nenhum (CRUD trivial — Global Constraints).

**Interfaces:**
- Produces: `POST/GET/PATCH /api/categories` sob `@Roles('ADMIN')` para escrita, `GET` para qualquer usuário interno. Campos: `name (unique)`, `active`.

- [ ] **Step 1: Implementar** service/controller seguindo o padrão da Task 3.1 (sem paginação — lista simples ordenada por `name`).
- [ ] **Step 2:** subir e testar `GET /api/categories` retornando o seed.
- [ ] **Step 3: Commit** `git commit -m "feat(categories): CRUD de categorias"`

### Task 3.3: Usuários internos + contatos + convite

**Files:**
- Create: `backend/src/users/users.{service,controller,module}.ts`, `dto/{create-internal,create-contact,update-user,set-password}.dto.ts`
- Test: `backend/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `hashPassword`, `EmailService` (stub até Fase 8 — injetar interface `MailSender` com `sendInvite(user, link)`), `randomBytes`.
- Produces:
  - `POST /api/users/internal` (`@Roles('ADMIN')`) `{name,email,role: ADMIN|AGENT, password}` → cria `type=INTERNAL`, hash da senha, `active=true`.
  - `POST /api/clients/:clientId/contacts` (`@Roles('ADMIN','AGENT')`) `{name,email,role: MANAGER|CONTACT}` → cria `type=CLIENT`, `passwordHash=null`, `inviteToken=randomBytes(32).hex`, `inviteSentAt=now`, dispara `sendInvite`.
  - `POST /api/auth/set-password` (`@Public()`) `{token,password}` → acha por `inviteToken` válido (<=7 dias), grava hash, `active=true`, limpa token. Reusa em "esqueci a senha" (Task 8.x gera novo token).
  - `GET /api/users?type=&clientId=` para listagem.
  - `UsersService.findByEmail(email)` (usado pelo inbound).

- [ ] **Step 1: Teste que falha**
  - `createContact` gera `inviteToken` e chama `mail.sendInvite`.
  - `setPassword` rejeita token com `inviteSentAt` > 7 dias (`BadRequestException`).

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar.** `MailSender` como token de injeção (`@Inject('MailSender')`), provider temporário que só loga — trocado na Fase 8.

- [ ] **Step 4: Rodar** → PASS.

- [ ] **Step 5: Commit** `git commit -m "feat(users): internos, contatos de cliente e fluxo de convite"`

---

## Fase 4 — SLA

### Task 4.1: SlaPolicy CRUD + cálculo de vencimento

**Files:**
- Create: `backend/src/sla/sla.{service,controller,module}.ts`, `dto/update-sla.dto.ts`
- Test: `backend/src/sla/sla.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces:
  - `SlaService.dueAt(priority: TicketPriority, from: Date): Promise<Date>` — `from + hours*3600_000` lendo `SlaPolicy`.
  - `GET /api/sla` → 4 linhas; `PATCH /api/sla/:priority {hours}` (`@Roles('ADMIN')`).

- [ ] **Step 1: Teste que falha**

```ts
it('calcula vencimento a partir da política', async () => {
  prisma.slaPolicy.findUnique.mockResolvedValue({ priority: 'HIGH', hours: 8 });
  const due = await service.dueAt('HIGH', new Date('2026-01-01T00:00:00Z'));
  expect(due.toISOString()).toBe('2026-01-01T08:00:00.000Z');
});
```

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(sla): política por prioridade e cálculo de vencimento"`

---

## Fase 5 — Chamados (núcleo)

### Task 5.1: Numeração transacional

**Files:**
- Create: `backend/src/tickets/ticket-number.service.ts`
- Test: `backend/src/tickets/ticket-number.service.spec.ts` (usa banco real de teste)

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `TicketNumberService.next(tx: Prisma.TransactionClient, year = currentYear): Promise<string>` — `upsert` no `Counter` com `value: { increment: 1 }` dentro da transação, formata `${year}-${String(value).padStart(4,'0')}`.

- [ ] **Step 1: Teste que falha** — chamar `next` 3× em transações sequenciais dá `2026-0001..0003`; duas transações concorrentes não colidem (rodar `Promise.all` de 20 e conferir 20 números distintos).

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar** com `tx.counter.upsert`. O lock de linha do Postgres no `upsert` serializa os incrementos.

- [ ] **Step 4: Rodar** → PASS (20 números únicos).

- [ ] **Step 5: Commit** `git commit -m "feat(tickets): numeração anual transacional"`

### Task 5.2: Criar chamado + timeline CREATED

**Files:**
- Create: `backend/src/tickets/tickets.{service,controller,module}.ts`, `dto/create-ticket.dto.ts`
- Create: `backend/src/tickets/ticket-events.service.ts`
- Test: `backend/src/tickets/tickets.service.spec.ts`

**Interfaces:**
- Consumes: `TicketNumberService`, `SlaService`, `PrismaService`, `NotificationsService` (stub interface `TicketNotifier` com `created(ticket)`).
- Produces:
  - `TicketsService.create(input, actor): Promise<Ticket>` onde `input = { title, description, clientId?, requesterId?, categoryId?, priority?, origin, equipment? }`.
    - `priority` default `MEDIUM`; `status = OPEN`; `number` via `TicketNumberService.next(tx)`; `slaDueAt = SlaService.dueAt(priority, now)`.
    - `origin=PORTAL|MANUAL` exige `clientId` e `requesterId` (senão `BadRequestException`); `origin=EMAIL` pode omitir com `needsTriage=true`.
    - Grava `TicketEvent {type: CREATED, actorId: actor?.id}` na mesma transação.
    - Fora da transação: `notifier.created(ticket)`.
  - `TicketEventsService.record(tx|prisma, ticketId, type, data?, actorId?)`.
  - `POST /api/tickets` (`@Roles('ADMIN','AGENT')`) — criação manual.

- [ ] **Step 1: Teste que falha**
  - cria com `origin=MANUAL` sem `clientId` → `BadRequestException`.
  - cria válido → `number` no formato, `slaDueAt` = now + 24h (MEDIUM), 1 `TicketEvent CREATED`, `notifier.created` chamado.

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** dentro de `prisma.$transaction`.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): criação de chamado com numeração, SLA e timeline"`

### Task 5.3: Listagem com visibilidade por papel

**Files:**
- Modify: `backend/src/tickets/tickets.service.ts` (+`findAll`), `tickets.controller.ts`
- Create: `backend/src/tickets/dto/list-tickets.dto.ts`
- Test: `backend/src/tickets/tickets-visibility.spec.ts`

**Interfaces:**
- Produces: `TicketsService.findAll(query, actor)` → `{ data, total, page, pageSize }`.
  - `actor.role=CONTACT` → `where.requesterId = actor.id`.
  - `actor.role=MANAGER` → `where.clientId = actor.clientId`.
  - `actor.type=INTERNAL` → sem restrição; aceita filtros `status, priority, clientId, assigneeId, categoryId, overdue (bool), q (number/title)`.
  - `overdue=true` → `slaDueAt < now AND status NOT IN (RESOLVED,CLOSED,CANCELLED)`.
  - Ordenação default: `createdAt desc`.

- [ ] **Step 1: Teste que falha** — 3 chamados (dois do cliente X sendo um do contato A; um do cliente Y). `findAll` como CONTACT A → 1; como MANAGER de X → 2; como AGENT → 3.

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** montagem de `where` por papel.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): listagem com filtros e visibilidade por papel"`

### Task 5.4: Detalhe + guarda de acesso

**Files:**
- Modify: `tickets.service.ts` (`findOne(id, actor)`), `tickets.controller.ts`
- Test: incluir em `tickets-visibility.spec.ts`

**Interfaces:**
- Produces: `findOne(id, actor)` — carrega `client, requester, assignee, category, comments (ordenados), events` e **filtra**: se `actor.type=CLIENT`, remove `comments` com `visibility=INTERNAL` e `events` de tipo interno (`ASSIGNED`, `PRIORITY_CHANGED`, `EMAIL_OUT`); aplica a mesma checagem de escopo do `findAll` e lança `NotFoundException` se fora do escopo (não `Forbidden`, para não vazar existência).

- [ ] **Step 1: Teste que falha** — CONTACT de outro cliente → `NotFoundException`; CLIENT dono → recebe ticket sem comentários internos.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): detalhe com filtragem de itens internos"`

### Task 5.5: Transições de status

**Files:**
- Create: `backend/src/tickets/ticket-status.service.ts`
- Modify: `tickets.service.ts` (`changeStatus`), `tickets.controller.ts` (`PATCH /api/tickets/:id/status`)
- Test: `backend/src/tickets/ticket-status.service.spec.ts`

**Interfaces:**
- Produces: `changeStatus(id, next: TicketStatus, actor)`:
  - Permitido só para `INTERNAL`.
  - `RESOLVED` → grava `resolvedAt=now`, dispara `notifier.resolved(ticket)`.
  - `CLOSED` → grava `closedAt=now`.
  - sair de `RESOLVED`/`CLOSED` só para `OPEN` (reabertura) → limpa `resolvedAt`/`closedAt`.
  - `CANCELLED` não pode transicionar para nada exceto `OPEN`.
  - Sempre grava `TicketEvent {type: STATUS_CHANGED, data:{from,to}, actorId}`.
  - `helper resolveClientReply(ticketId)` (exportado): se status atual `WAITING_CLIENT` → muda para `IN_PROGRESS` + evento; usado pelos comentários e pelo inbound.

- [ ] **Step 1: Teste que falha**
  - `OPEN→RESOLVED` grava `resolvedAt` e chama `notifier.resolved`.
  - `RESOLVED→IN_PROGRESS` lança `BadRequestException` (só `OPEN` permitido).
  - `resolveClientReply` em ticket `WAITING_CLIENT` → vira `IN_PROGRESS`.

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** tabela de transições permitidas + efeitos.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): transições de status com efeitos e reabertura"`

### Task 5.6: Atribuição e mudança de prioridade

**Files:**
- Modify: `tickets.service.ts` (`assign`, `changePriority`), `tickets.controller.ts`
- Test: `backend/src/tickets/tickets-mutations.spec.ts`

**Interfaces:**
- Produces:
  - `assign(id, assigneeId|null, actor)` (`INTERNAL`) → set `assigneeId`; `TicketEvent ASSIGNED {from,to}`; se novo responsável, `notifier.assigned(ticket)`.
  - `changePriority(id, priority, actor)` (`INTERNAL`) → set `priority`; se status não terminal, **recalcula `slaDueAt = SlaService.dueAt(priority, ticket.createdAt)`**; `TicketEvent PRIORITY_CHANGED {from,to}`.
  - Rotas `PATCH /api/tickets/:id/assign`, `PATCH /api/tickets/:id/priority`.

- [ ] **Step 1: Teste que falha** — `changePriority` de MEDIUM→URGENT recalcula `slaDueAt` para `createdAt + 4h`; em ticket `CLOSED` não recalcula.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): atribuição e recálculo de SLA na prioridade"`

---

## Fase 6 — Andamentos

### Task 6.1: Comentários interno/público + firstResponseAt

**Files:**
- Create: `backend/src/comments/comments.{service,controller,module}.ts`, `dto/create-comment.dto.ts`
- Test: `backend/src/comments/comments.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `TicketEventsService`, `ticket-status.resolveClientReply`, `NotificationsService` (`TicketNotifier.publicComment(ticket, comment)`).
- Produces:
  - `CommentsService.create(ticketId, { body, visibility }, actor)`:
    - `CLIENT` só pode `visibility=PUBLIC`; ignora/rejeita `INTERNAL`.
    - Aplica a mesma guarda de escopo do `findOne`.
    - Grava `TicketComment` + `TicketEvent {type: COMMENT, data:{visibility}, actorId}`.
    - Se autor `INTERNAL` e `visibility=PUBLIC` e `ticket.firstResponseAt` nulo → set `firstResponseAt=now`.
    - Se autor `CLIENT` → `resolveClientReply(ticketId)`.
    - Se `visibility=PUBLIC` → `notifier.publicComment(ticket, comment)`.
  - `POST /api/tickets/:id/comments`.

- [ ] **Step 1: Teste que falha**
  - CLIENT enviando `INTERNAL` → `ForbiddenException` (ou coage p/ PUBLIC — escolher **rejeitar**).
  - 1º comentário público de AGENT grava `firstResponseAt`; o 2º não altera.
  - comentário de CLIENT em ticket `WAITING_CLIENT` → status vira `IN_PROGRESS`.

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(comments): andamentos internos/públicos e primeira resposta"`

---

## Fase 7 — Anexos

### Task 7.1: Upload em disco + download com acesso

**Files:**
- Create: `backend/src/attachments/attachments.{service,controller,module}.ts`, `storage.util.ts`
- Test: `backend/src/attachments/attachments.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `tickets.findOne` (para guarda de acesso).
- Produces:
  - `POST /api/tickets/:id/attachments` (multipart, `FileInterceptor`) e `POST /api/comments/:id/attachments` — grava em `${STORAGE_PATH}/${cuid}${ext}`, cria `Attachment` com exatamente um de `ticketId`/`commentId`.
  - `GET /api/attachments/:id` → valida acesso do `actor` ao ticket dono, faz `res.sendFile` com `Content-Disposition`.
  - Limite 10 MB, `mime` allowlist (imagens, pdf, txt, log, zip). Rejeição → `BadRequestException`.
  - `AttachmentsService.saveForTicket(ticketId, file, actor)` e `saveForComment(commentId, file, actor)` (reusados pelo inbound).

- [ ] **Step 1: Teste que falha** — `saveForTicket` rejeita `mime` não permitido e arquivo > 10 MB; grava caminho previsível; `getForDownload` de outro cliente → `NotFoundException`.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** com `@nestjs/platform-express` `FileInterceptor`, `fs/promises.writeFile`, `mkdir -p` do `STORAGE_PATH` no boot.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(attachments): upload em disco e download com checagem de acesso"`

---

## Fase 8 — E-mail de saída e notificações

### Task 8.1: EmailService (Resend) + templates

**Files:**
- Create: `backend/src/email/email.{service,module}.ts`, `templates/*.ts` (funções que retornam `{subject, html}`)
- Test: `backend/src/email/email.service.spec.ts`

**Interfaces:**
- Consumes: env `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, `PORTAL_URL`.
- Produces:
  - `EmailService.send({ to, subject, html, headers?, replyTo? })` → chama `resend.emails.send`; em teste, `resend` é mockado.
  - Templates: `ticketCreated(ticket)`, `ticketCreatedInternal(ticket)`, `ticketComment(ticket, comment)`, `ticketAssigned(ticket)`, `ticketResolved(ticket)`, `ticketSlaBreached(ticket)`, `contactInvite(user, link)`. Todos em pt-BR, texto simples com HTML mínimo.
  - `replyTo = MAIL_FROM`; header `References` recebe `ticket.number` para threading.
  - Implementa o token `'MailSender'` da Task 3.3 (`sendInvite` → `contactInvite`).

- [ ] **Step 1: Teste que falha** — `send` repassa `from=MAIL_FROM` e `replyTo`; `ticketCreated` inclui `ticket.number` no subject (`[#2026-0001]`).
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(email): EmailService via Resend e templates pt-BR"`

### Task 8.2: NotificationsService

**Files:**
- Create: `backend/src/notifications/notifications.{service,module}.ts`
- Modify: `tickets.module.ts`, `comments.module.ts`, `users.module.ts` — trocar stubs pelo real
- Test: `backend/src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: `EmailService`, `PrismaService`.
- Produces (implementa `TicketNotifier` + `TicketNotifier` usado nos services anteriores):
  - `created(ticket)` → e-mail ao `requester` (se houver) + a todos `ADMIN` ativos.
  - `publicComment(ticket, comment)` → ao `requester` + `MANAGER`(es) do `client`, **exceto** o autor.
  - `assigned(ticket)` → ao `assignee`.
  - `resolved(ticket)` → ao `requester`.
  - `slaBreached(ticket)` → ao `assignee` (se houver) + `ADMIN`s.
  - Cada método resolve destinatários e chama `EmailService.send` uma vez por destinatário. Falha de e-mail é logada, não propaga (`try/catch`).

- [ ] **Step 1: Teste que falha** — `publicComment` não envia para o autor do comentário; `created` sem `requester` (triagem) envia só aos admins.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.** Substituir os providers stub (`TicketNotifier`, `TicketNotifier`) nos módulos por `NotificationsService`.
- [ ] **Step 4: Rodar** toda a suíte de tickets/comments → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(notifications): disparo de e-mail por evento do chamado"`

### Task 8.3: Esqueci a senha

**Files:**
- Modify: `backend/src/auth/auth.{service,controller}.ts`
- Test: incluir em `auth.service.spec.ts`

**Interfaces:**
- Produces: `POST /api/auth/forgot-password {email}` (`@Public()`) → se usuário existe, gera novo `inviteToken`/`inviteSentAt` e envia `contactInvite` com link `${PORTAL_URL}/definir-senha?token=...` (ou `${APP_URL}` se `type=INTERNAL`). Sempre responde `204` (não revela existência).

- [ ] **Step 1: Teste que falha** — email inexistente → `204` sem enviar; existente → token gerado + e-mail.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar** reusando o fluxo de token da Task 3.3.
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(auth): recuperação de senha por e-mail"`

---

## Fase 9 — E-mail de entrada

### Task 9.1: Parsing e dedupe do webhook

**Files:**
- Create: `backend/src/inbound/inbound.{controller,service,module}.ts`, `dto/resend-inbound.dto.ts`, `email-body.util.ts`
- Test: `backend/src/inbound/email-body.util.spec.ts`, `inbound.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `UsersService.findByEmail`, `ClientsService` (busca por domínio), `TicketsService.create`, `CommentsService.create` (ou caminho interno equivalente), `AttachmentsService`.
- Produces:
  - `POST /api/webhooks/resend/inbound` (`@Public()`) — valida assinatura via `RESEND_INBOUND_SECRET` (header do Resend); inválida → `401`.
  - `stripQuotedText(text): string` — remove linhas iniciadas por `>` e bloco após marcadores comuns (`Em .* escreveu:`, `On .* wrote:`, `-----Original Message-----`).
  - `InboundService.handle(payload)`:
    1. `messageId` do payload; se já existe `InboundEmail` → `200` no-op (dedupe).
    2. Threading: `In-Reply-To`/`References` casando `InboundEmail.messageId` conhecido → pega `ticketId`. Fallback: regex `/\[#(\d{4}-\d{4})\]/` no `subject` → `Ticket.number`.
    3. Se achou ticket → adiciona comentário `PUBLIC` (autor = `requester` do ticket), `TicketEvent EMAIL_IN`, `resolveClientReply`.
    4. Senão → novo chamado: `findByEmail(from)`; se não achar, casa domínio com `Client.emailDomains`:
       - domínio conhecido → cria `User CONTACT active=false` nesse client, usa como `requesterId`.
       - domínio desconhecido → `create({ origin: EMAIL, needsTriage: true, clientId: null, requesterId: null, title: subject, description: bodyLimpo })`.
    5. Anexos do payload → `AttachmentsService.saveForTicket`.
    6. Grava `InboundEmail { messageId, ticketId, fromEmail, subject, headers }`.

- [ ] **Step 1: Testes que falham**
  - `stripQuotedText` remove citação e assinatura.
  - `handle` com `messageId` repetido não cria segundo ticket.
  - `handle` com `[#2026-0001]` no assunto anexa comentário ao ticket 1.
  - `handle` de domínio desconhecido cria ticket `needsTriage=true`.

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(inbound): webhook Resend com dedupe, threading e triagem"`

### Task 9.2: Endpoint de triagem

**Files:**
- Modify: `tickets.service.ts` (`triage(id, {clientId, requesterId}, actor)`), `tickets.controller.ts`
- Test: incluir em `tickets-mutations.spec.ts`

**Interfaces:**
- Produces: `PATCH /api/tickets/:id/triage` (`@Roles('ADMIN','AGENT')`) — só se `needsTriage`; set `clientId`, `requesterId`, `needsTriage=false`; `TicketEvent {type: STATUS_CHANGED?}` não — usar `data` livre num `COMMENT` interno automático "Chamado vinculado ao cliente X". Filtro na listagem: `needsTriage=true` aparece para internos com badge.

- [ ] **Step 1: Teste que falha** — `triage` em ticket sem `needsTriage` → `BadRequestException`; com → vincula e baixa a flag.
- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar** → PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(tickets): triagem de chamados de e-mail sem cliente"`

---

## Fase 10 — Cron de SLA

### Task 10.1: Varredura de SLA vencido

**Files:**
- Create: `backend/src/tasks/sla-breach.cron.ts`, `tasks.module.ts`
- Test: `backend/src/tasks/sla-breach.cron.spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `NotificationsService.slaBreached`.
- Produces: `SlaBreachCron.run()` com `@Cron('*/15 * * * *')`:
  - busca tickets `slaDueAt < now`, status ∉ terminais, `slaBreachNotifiedAt` nulo (adicionar campo `Ticket.slaBreachNotifiedAt DateTime?` — **migration nesta task**).
  - para cada: `notifier.slaBreached(ticket)`, set `slaBreachNotifiedAt=now`.

- [ ] **Step 1: Migration** `npx prisma migrate dev --name ticket_sla_breach_notified`.
- [ ] **Step 2: Teste que falha** — `run()` notifica só os vencidos não-notificados e marca `slaBreachNotifiedAt`; segunda chamada não renotifica.
- [ ] **Step 3: Rodar** → FAIL.
- [ ] **Step 4: Implementar.**
- [ ] **Step 5: Rodar** → PASS.
- [ ] **Step 6: Commit** `git commit -m "feat(sla): cron de notificação de SLA vencido"`

---

## Fase 11 — Frontend: fundação

### Task 11.1: Cliente de API + sessão

**Files:**
- Create: `frontend/src/lib/api.ts`, `src/lib/auth.tsx`, `src/app/providers.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Produces:
  - `api<T>(path, init?): Promise<T>` — injeta `Authorization: Bearer <accessToken>` (memória + `localStorage`), em `401` chama `POST /auth/refresh` (cookie) uma vez e repete; se falhar, limpa sessão e redireciona ao login da área.
  - `SessionProvider` + `useSession()` → `{ user, login(email,pw), logout() }`. `user` carregado de `/auth/me` (adicionar `GET /api/auth/me` no backend nesta task — retorna `req.user` hidratado).
  - `providers.tsx` monta `QueryClientProvider` + `SessionProvider` + `<Toaster/>`.

- [ ] **Step 1:** adicionar `GET /api/auth/me` no `auth.controller.ts` (retorna user por `req.user.id`).
- [ ] **Step 2:** implementar `api.ts` com a lógica de refresh (guarda de corrida: uma única promessa de refresh compartilhada).
- [ ] **Step 3:** implementar `auth.tsx` e `providers.tsx`.
- [ ] **Step 4:** `npm run build` do front sem erro de tipo.
- [ ] **Step 5: Commit** `git commit -m "feat(frontend): cliente de API com refresh e contexto de sessão"`

### Task 11.2: Layouts e guardas de rota

**Files:**
- Create: `src/app/(app)/layout.tsx`, `src/app/(portal)/layout.tsx`, `src/components/nav.tsx`
- Create: `src/app/(app)/login/page.tsx`, `src/app/(portal)/login/page.tsx`, `src/app/(portal)/definir-senha/page.tsx`

**Interfaces:**
- Produces:
  - `(app)/layout` — exige `user.type=INTERNAL`, senão `redirect('/login')` (área app). Sidebar com: Fila, Clientes, Configurações.
  - `(portal)/layout` — exige `user.type=CLIENT`. Header simples.
  - Telas de login (react-hook-form + zod) chamando `useSession().login`.
  - `definir-senha` lê `?token=`, form de senha, `POST /api/auth/set-password`.

- [ ] **Step 1:** implementar layouts com checagem de sessão no client (`useSession`, estado de carregando).
- [ ] **Step 2:** telas de login das duas áreas + `definir-senha`.
- [ ] **Step 3:** testar manual: login admin → cai na Fila; login contato → cai no portal.
- [ ] **Step 4: Commit** `git commit -m "feat(frontend): layouts das áreas app/portal e telas de acesso"`

---

## Fase 12 — Frontend: área da equipe

### Task 12.1: Fila de chamados

**Files:**
- Create: `src/app/(app)/page.tsx` (fila), `src/components/ticket-table.tsx`, `src/lib/tickets.ts` (hooks TanStack Query)

**Interfaces:**
- Consumes: `GET /api/tickets` com query `page,pageSize,q,status,priority,clientId,assigneeId,categoryId,overdue`.
- Produces: `useTickets(filters)`, tabela com colunas Número, Título, Cliente, Prioridade, Status, Responsável, SLA (badge "vencido" se `slaDueAt<now` e não terminal), Criado em. Filtros no topo (selects + busca). Linha clica → `/(app)/chamados/[id]`.

- [ ] **Step 1:** implementar hooks + tabela + filtros.
- [ ] **Step 2:** testar manual com dados semeados/criados via API.
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): fila de chamados com filtros"`

### Task 12.2: Detalhe do chamado

**Files:**
- Create: `src/app/(app)/chamados/[id]/page.tsx`, `src/components/ticket-timeline.tsx`, `src/components/comment-box.tsx`, `src/components/ticket-sidebar.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /api/tickets/:id`, `/status`, `/assign`, `/priority`, `/triage`, `POST /api/tickets/:id/comments`, `POST /api/tickets/:id/attachments`, `GET /api/attachments/:id`.
- Produces:
  - Cabeçalho: número + título; selects inline de status, prioridade, responsável (lista de `GET /api/users?type=INTERNAL`).
  - `comment-box`: textarea + alternância **Interno / Público** + anexos; submit → `POST comments`.
  - `timeline`: comentários (estilo por `visibility`) + eventos (texto legível por tipo), ordem cronológica.
  - `sidebar`: cliente, solicitante, categoria, origem, datas, SLA. Se `needsTriage` → bloco de vínculo (select cliente → select contato) → `PATCH /triage`.
  - Após qualquer mutação, `queryClient.invalidateQueries(['ticket', id])`.

- [ ] **Step 1:** implementar componentes.
- [ ] **Step 2:** testar manual: comentar público/interno, mudar status, atribuir, triagem.
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): detalhe do chamado com timeline e ações"`

### Task 12.3: Novo chamado (manual)

**Files:**
- Create: `src/app/(app)/chamados/novo/page.tsx`

**Interfaces:**
- Consumes: `GET /api/clients`, `GET /api/clients/:id/contacts` (adicionar no backend: `GET` de contatos por cliente — reusa `users.findAll({type:CLIENT, clientId})`), `GET /api/categories`, `POST /api/tickets`.
- Produces: form: cliente → contato → título, descrição, categoria, prioridade, equipamento. Submit → redireciona ao detalhe.

- [ ] **Step 1:** adicionar rota `GET /api/clients/:id/contacts` no backend.
- [ ] **Step 2:** implementar form.
- [ ] **Step 3:** testar manual.
- [ ] **Step 4: Commit** `git commit -m "feat(frontend): criação manual de chamado"`

### Task 12.4: Clientes e contatos

**Files:**
- Create: `src/app/(app)/clientes/page.tsx`, `clientes/[id]/page.tsx`, `src/components/client-form.tsx`, `contact-form.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/clients`, `GET/POST /api/clients/:id/contacts`, `PATCH /api/users/:id` (ativar/desativar contato), `POST /api/auth/forgot-password` (reenviar convite — ou endpoint dedicado `POST /api/users/:id/resend-invite`; **usar forgot-password** para não criar rota nova).
- Produces: lista de clientes (busca, ativo/inativo), detalhe com abas Contatos (tabela + "novo contato" + "reenviar convite") e Chamados (reusa `ticket-table` filtrada por `clientId`).

- [ ] **Step 1:** implementar telas.
- [ ] **Step 2:** testar manual: criar cliente, criar contato (recebe log/e-mail de convite), definir senha, logar no portal.
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): gestão de clientes e contatos"`

### Task 12.5: Configurações

**Files:**
- Create: `src/app/(app)/config/page.tsx` (abas: Categorias, SLA, Usuários)

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/categories`, `GET/PATCH /api/sla`, `GET/POST /api/users/internal`, `PATCH /api/users/:id`.
- Produces: CRUD simples de categorias; 4 inputs de horas de SLA; lista + criação de usuários internos com papel.

- [ ] **Step 1:** implementar as 3 abas.
- [ ] **Step 2:** testar manual.
- [ ] **Step 3: Commit** `git commit -m "feat(frontend): tela de configurações"`

---

## Fase 13 — Frontend: portal do cliente

### Task 13.1: Lista e abertura de chamado

**Files:**
- Create: `src/app/(portal)/page.tsx`, `src/app/(portal)/chamados/novo/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tickets` (backend já restringe por papel), `GET /api/categories`, `POST /api/tickets` (origin `PORTAL`, `clientId`/`requesterId` derivados do `req.user` no backend — **ajustar `TicketsService.create`/controller**: quando `actor.type=CLIENT`, força `clientId=actor.clientId`, `requesterId=actor.id`, `origin=PORTAL`, ignora campos enviados).
- Produces: lista dos chamados visíveis (contato: os seus; gerente: todos da empresa) com número/título/status; botão "Abrir chamado" → form (título, descrição, categoria, prioridade sugerida, anexos).

- [ ] **Step 1:** ajustar backend para criação via portal derivar cliente/solicitante do token.
- [ ] **Step 2:** implementar telas do portal.
- [ ] **Step 3:** testar manual como CONTACT e como MANAGER.
- [ ] **Step 4: Commit** `git commit -m "feat(portal): lista e abertura de chamados pelo cliente"`

### Task 13.2: Detalhe no portal

**Files:**
- Create: `src/app/(portal)/chamados/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/tickets/:id` (backend já filtra itens internos), `POST /api/tickets/:id/comments` (backend força `PUBLIC` para CLIENT), `POST /api/tickets/:id/attachments`, `GET /api/attachments/:id`.
- Produces: timeline pública, caixa de resposta (só público, sem alternância), anexos. Sem edição de status/prioridade.

- [ ] **Step 1:** implementar.
- [ ] **Step 2:** testar manual: cliente responde, some para agente no painel; agente responde público, aparece no portal.
- [ ] **Step 3: Commit** `git commit -m "feat(portal): detalhe do chamado para o cliente"`

---

## Fase 14 — Fechamento

### Task 14.1: Smoke E2E (Playwright)

**Files:**
- Create: `frontend/e2e/portal-abre-chamado.spec.ts`, `frontend/playwright.config.ts`

**Interfaces:**
- Consumes: stack `docker-compose.dev` no ar + seed.
- Produces: teste que loga como contato (senha definida via API de setup no `beforeAll`), abre chamado, vê na lista.

- [ ] **Step 1:** config Playwright (`baseURL` do front, webServer opcional).
- [ ] **Step 2:** escrever o spec.
- [ ] **Step 3:** `npx playwright test` → PASS.
- [ ] **Step 4: Commit** `git commit -m "test(e2e): fluxo de abertura de chamado no portal"`

### Task 14.2: Fechar release 0.1.0

**Files:**
- Modify: `CHANGELOG.md`, `backend/package.json`, `frontend/package.json` (`"version": "0.1.0"`)

- [ ] **Step 1:** mover itens de "Não lançado" para `## [0.1.0] - 2026-XX-XX` com seções Adicionado (chamados, portal, e-mail de entrada/saída, SLA, Docker).
- [ ] **Step 2:** setar `version` 0.1.0 nos dois `package.json`.
- [ ] **Step 3:** `docker compose up --build` (produção) sobe os 3 serviços; `GET /api/categories` responde.
- [ ] **Step 4: Commit** `git commit -m "chore: release 0.1.0"` + `git tag v0.1.0`.

---

## Self-Review (feita)

**Cobertura do spec:**
- §3 arquitetura → Fase 0. §4 modelo → Task 1.1 (+ campo `slaBreachNotifiedAt` na 10.1). §5.1 numeração → 5.1. §5.2 transições → 5.5. §5.3 visibilidade → 5.3/5.4/6.1. §5.4 SLA → 4.1/5.2/5.6. §5.5 convite → 3.3/8.3. §6.1 inbound → 9.1/9.2. §6.2 portal → 13.1. §6.3 manual → 5.2/12.3. §7 notificações → 8.2/10.1. §8 auth → 2.x/11.1. §9 UI → 11–13. §10 deploy → 0.4/14.2. §11 testes → distribuídos + 14.1. §13 versionamento → 0.1/14.2.
- Ajuste vs. spec: criação via portal/inbound **deriva** `clientId`/`requesterId` no backend a partir do ator/domínio (Tasks 9.1, 13.1) — o DTO público não os aceita de cliente.
- Endpoints extra vs. spec, todos pequenos: `GET /api/auth/me`, `GET /api/clients/:id/contacts`. Sem rota nova de "reenviar convite" (reusa `forgot-password`).

**Placeholders:** nenhum "TBD/TODO"; toda task tem arquivos, interfaces e passos executáveis.

**Consistência de tipos:** `resolveClientReply`, `SlaService.dueAt`, `TicketEventsService.record`, `TicketNumberService.next`, `NotificationsService` (métodos `created/publicComment/assigned/resolved/slaBreached`) usados com a mesma assinatura em todas as tasks que os consomem.
