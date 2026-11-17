# Grupos de usuários e permissão por tela — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIO: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano task a task. Os passos usam checkbox (`- [ ]`).

**Objetivo:** criar grupos de usuários internos com uma lista de telas permitidas e aplicar o bloqueio no menu, na página e na API.

**Arquitetura:** um model novo, `UserGroup`, e o campo `User.groupId?`. Um `ScreenGuard` global (registrado depois do `RolesGuard`) lê o metadado `@Screen('x')` da rota e o grupo atual do usuário no banco. O `/auth/me` passa a devolver `screens`, e o front filtra o menu e redireciona rotas proibidas a partir de um mapa central.

**Stack:** NestJS 12 + Prisma 6 + Postgres, vitest (unit e integração), Next.js App Router, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-grupos-permissoes-design.md`

## Restrições globais

- Chaves de tela, exatamente estas: `dashboard`, `agenda`, `triagem`, `campo`, `clientes`, `ativos`, `contratos`, `crm`, `orcamentos`, `catalogo`, `estoque`, `base-conhecimento`, `config`.
- "Chamados / OS" (`/app`, `/app/chamados/*`) **nunca** tem tela: sempre liberado.
- Usuário sem grupo → comportamento idêntico ao atual. Usuário do portal (`type: CLIENT`) nunca é afetado pelo guard.
- **Admin pleno** = `role === 'ADMIN' && groupId === null`. Só ele gerencia grupos e muda o `groupId` de alguém.
- O grupo é lido do banco a cada request protegida, nunca do JWT.
- Excluir um grupo deixa os membros com `groupId = null` (`onDelete: SetNull`).
- Mensagem do 403: `Sem acesso a esta tela.`
- Migração: `add_user_groups`. Versão: `0.21.0` (backend e frontend `package.json`, `CHANGELOG.md`). Nenhuma env nova.
- Onde trabalhar: worktree a partir de `origin/main`, na branch `feat/grupos-permissoes`. O `C:/Users/renan/os-exec` está em `feat/inventario-agente` com mudanças não commitadas, que **não podem ser tocadas**.

## Pontos de atenção na revisão

1. **Seletor quebrando outra tela.** Um usuário sem `clientes` abre "Novo chamado" e o seletor de cliente precisa carregar (`GET /api/clients` → 200). O mesmo vale para locais, ativos, categorias, usuários, catálogo e depósitos. Teste na Task 3.
2. **Autopromoção.** Um ADMIN com grupo faz `PATCH /api/users/<próprio id>` com `{groupId: null}` → 403. Um `POST /api/user-groups` dele → 403. Teste na Task 3 e na Task 1.
3. **Mudança vale na hora.** Tirar `crm` do grupo faz o próximo `GET /api/opportunities` do usuário, com o mesmo token, dar 403. Teste na Task 3.
4. **Excluir grupo com membros.** Os membros ficam sem grupo, a API responde 200 e a UI avisa antes de confirmar. Teste na Task 1 (service) e copy na Task 5.
5. **Rota profunda no front.** Abrir `/app/crm/<id>` direto pela URL redireciona para `/app`, e não só `/app/crm`. Teste no E2E da Task 6.

---

### Task 1: Model `UserGroup` + CRUD (admin pleno)

**Arquivos:**
- Modificar: `backend/prisma/schema.prisma` (model `UserGroup`; `User.groupId String?` + `group UserGroup? @relation(fields: [groupId], references: [id], onDelete: SetNull)`)
- Criar: migração `backend/prisma/migrations/<ts>_add_user_groups/` via `npx prisma migrate dev --name add_user_groups`
- Criar: `backend/src/user-groups/screens.ts`, `user-groups.service.ts`, `user-groups.controller.ts`, `user-groups.module.ts`, `dto/user-group.dto.ts`
- Modificar: `backend/src/app.module.ts` (importar `UserGroupsModule`)
- Teste: `backend/src/user-groups/user-groups.service.spec.ts`

**Interfaces:**
- Produz:
  - `export const SCREENS = [...] as const; export type ScreenKey = (typeof SCREENS)[number];` em `screens.ts`
  - `UserGroupsService.isFullAdmin(userId: string): Promise<boolean>`
  - `UserGroupsService.screensFor(userId: string): Promise<ScreenKey[] | null>`. Devolve `null` quando o usuário não tem grupo ou é `CLIENT`.
  - `UserGroupsService.findAll(): Promise<Array<{id, name, screens, memberCount}>>`, `create(dto)`, `update(id, dto)`, `remove(id)`
  - `UserGroupDto { name: string (MinLength 1); screens: ScreenKey[] (IsIn(SCREENS, {each:true})) }`. O update usa `PartialType`.
  - Rotas `GET/POST /api/user-groups`, `PATCH/DELETE /api/user-groups/:id`, todas `@Roles('ADMIN')`. Cada handler recebe `@CurrentUser()` e chama `isFullAdmin`; se der falso → `ForbiddenException('Sem acesso a esta tela.')`.
  - Nome duplicado (`P2002`) → `ConflictException('Já existe um grupo com esse nome.')`.

- [ ] **Passo 1: Teste que falha** — `user-groups.service.spec.ts`, com mock manual do Prisma no padrão do `users.service.spec.ts`:
  - `isFullAdmin`: `{role:'ADMIN', groupId:null}` → `true`; `{role:'ADMIN', groupId:'g1'}` → `false`; `{role:'AGENT', groupId:null}` → `false`.
  - `screensFor`: sem grupo → `null`; `type:'CLIENT'` → `null`; com grupo `{screens:['crm']}` → `['crm']`.
  - `create` com `P2002` → `ConflictException`.
  - `remove` chama `prisma.userGroup.delete({where:{id}})` (o `SetNull` fica com o banco).
- [ ] **Passo 2:** `cd backend && npx vitest run src/user-groups` → FALHA (módulo não existe).
- [ ] **Passo 3:** schema + migração + implementação.
- [ ] **Passo 4:** `npx vitest run src/user-groups` → PASSA; `npx nest build` → ok.
- [ ] **Passo 5: Commit** `feat(user-groups): model e CRUD de grupos (admin pleno)`

### Task 2: `@Screen`, `@SkipScreen`, `ScreenGuard` e `screens` no `/auth/me`

**Arquivos:**
- Criar: `backend/src/common/screen.decorator.ts`, `backend/src/common/screen.guard.ts`
- Modificar: `backend/src/common/common.module.ts` (3º `APP_GUARD`, depois do `RolesGuard`; importar `UserGroupsModule`, que exporta o service)
- Modificar: `backend/src/auth/auth.controller.ts` `me()` → `{ ...publicUser, screens }`
- Modificar: `backend/src/users/user-view.ts` (`publicUser` passa a incluir `groupId`)
- Teste: `backend/src/common/screen.guard.spec.ts`, `backend/src/auth/auth.controller.spec.ts` (caso novo)

**Interfaces:**
- Consome: `UserGroupsService.screensFor`, `ScreenKey` (Task 1).
- Produz:
  - `Screen(key: ScreenKey)` → `SetMetadata('screen', key)`; `SkipScreen()` → `SetMetadata('screen', null)`. Usar `getAllAndOverride([handler, class])`, para que o método vença a classe e `null` desligue a checagem.
  - `ScreenGuard.canActivate`: sem metadado, ou com `null` → `true`; sem `req.user` → `true` (o `JwtAuthGuard`/`@Public` já decidiram); `screensFor(user.id)` igual a `null` → `true`; tela incluída → `true`; senão `ForbiddenException('Sem acesso a esta tela.')`.
  - `GET /auth/me` devolve `screens: ScreenKey[] | null`.

- [ ] **Passo 1: Teste que falha** — `screen.guard.spec.ts` com `Reflector` real e controllers fake decorados:
  - classe `@Screen('crm')`, usuário sem grupo → `true`
  - classe `@Screen('crm')`, grupo `['clientes']` → lança `ForbiddenException`
  - classe `@Screen('crm')`, método `@SkipScreen()`, grupo `['clientes']` → `true`
  - rota sem metadado, grupo `[]` → `true` e `screensFor` **não** é chamado
  - `auth.controller.spec`: `me()` devolve `screens: ['crm']` quando o service retorna `['crm']`
- [ ] **Passo 2:** `npx vitest run src/common src/auth` → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `npx vitest run` (suíte unit inteira) → PASSA, exceto a falha pré-existente conhecida em `src/tasks/contract-preventive.cron.spec.ts`. Depois, `npm run build && npm run start:prod` sobe sem erro de DI (lição da 0.4.0/0.7.0: guard novo com injeção só quebra no boot real).
- [ ] **Passo 5: Commit** `feat(auth): ScreenGuard por grupo e screens no /auth/me`

### Task 3: Marcar os controllers + `groupId` no usuário + integração

**Arquivos:**
- Modificar os controllers abaixo (decorator na classe; `@SkipScreen()` nos métodos de seletor)
- Modificar: `backend/src/users/dto/update-user.dto.ts` (`groupId?: string | null`, `@IsOptional() @IsString()` com `ValidateIf(v => v !== null)`), `users.service.ts` `update(id, dto, actor)`, `users.controller.ts` (passa `@CurrentUser()`)
- Modificar: `backend/src/users/dto/create-internal.dto.ts` + `createInternal` (`groupId?` opcional, mesma regra)
- Teste: `backend/src/user-groups/user-groups.integration.spec.ts` (padrão do `assets.integration.spec.ts`: pula sem `DATABASE_URL`)

**Mapa controller → tela** (`@SkipScreen()` = rota de seletor/uso cruzado que fica aberta):

| Controller | Tela | `@SkipScreen()` em |
|---|---|---|
| `dashboard` | `dashboard` | — |
| `whatsapp/suggestions` | `triagem` | — |
| `clients` | `clientes` | `GET /clients` (lista) |
| `locations` | `clientes` | `GET` de lista |
| `assets`, `agent/agent-devices` | `ativos` | `GET /assets` (lista) |
| `contracts` | `contratos` | — |
| `crm/opportunities` | `crm` | — |
| `quotes` | `orcamentos` | — |
| `catalog` | `catalogo` | `GET /catalog` (lista) |
| `stock` | `estoque` | `GET` de depósitos e saldos usados por `ticket-material-usages` |
| `knowledge` | `base-conhecimento` | `GET .../suggestions` |
| `settings`, `sla`, `backup`, `audit`, `integrations`, `agent/improvements`, `whatsapp/{setup,status,groups,trigger-phrases,messages}` | `config` | — |
| `categories`, `asset-types`, `checklist-templates` | `config` | `GET` de lista |

Sem tela (núcleo de chamado, público ou agente): `tickets`, `comments`, `attachments`, `visits`, `ticket-material-usages`, `users` (o `findAll` alimenta seletores; a escrita já é ADMIN), `auth`, `branding`, `inbound`, `quotes-public`, `surveys-public`, `whatsapp-webhook`, `agent`, `client-agent`, `app`, `user-groups`.
`// ponytail:` `visits` fica sem tela porque é usado pela ficha do chamado. A tela `agenda`/`campo` bloqueia só no front. Separar quando precisar.

O implementador confere cada `GET` de lista contra o uso real no front (`grep -rn "api.*'/clients" frontend/src` etc.). Se um seletor em outra tela consome a rota, ela leva `@SkipScreen()`.

**Regra do `groupId` em `users.update`/`createInternal`:** se `dto.groupId !== undefined` e `!isFullAdmin(actor.id)` → `ForbiddenException('Sem acesso a esta tela.')`. Um `groupId` inexistente (`P2003`/`P2025`) → `BadRequestException('Grupo não encontrado.')`. Só usuário `INTERNAL` pode ter grupo; se for `CLIENT` → `BadRequestException('Grupos são só para usuários internos.')`.

- [ ] **Passo 1: Teste que falha** — `user-groups.integration.spec.ts` monta o app com `JwtAuthGuard` substituído por um stub que injeta `req.user` a partir do header `x-test-user` (ou usa o padrão que o `assets.integration.spec.ts` usa para papel), mais `RolesGuard` e `ScreenGuard` reais. Seed: grupo `{PFX} Quase admin` com todas as telas menos `crm` e `clientes`; usuário ADMIN `u1` nesse grupo; admin pleno `u0`.
  - `u1` `GET /opportunities` → 403, corpo com `Sem acesso a esta tela.`
  - `u1` `GET /clients` → 200 (seletor); `u1` `GET /clients/:id` → 403
  - `u1` `GET /dashboard/...` (alguma rota existente) → 200
  - `u1` `PATCH /users/u1 {groupId:null}` → 403; `u1` `POST /user-groups` → 403
  - `u0` `PATCH /user-groups/:g {screens: [...todas]}` e, em seguida, `u1` `GET /opportunities` → 200 (mudança na hora)
  - `u0` `DELETE /user-groups/:g` → 200, e `u1.groupId` no banco vira `null`
- [ ] **Passo 2:** `npm run test:integration -- user-groups` → FALHA.
- [ ] **Passo 3:** decorar os controllers e implementar a regra do `groupId`.
- [ ] **Passo 4:** `npm run test:integration` (todas) + `npx vitest run` → PASSA (mesma exceção conhecida).
- [ ] **Passo 5: Commit** `feat(permissoes): telas nos controllers e grupo no usuário`

### Task 4: Front — sessão, menu e guarda de rota

**Arquivos:**
- Criar: `frontend/src/lib/screens.ts`
- Modificar: `frontend/src/lib/auth.tsx` (`SessionUser.screens: string[] | null`, `groupId: string | null`)
- Modificar: `frontend/src/components/nav.tsx` (`appGroups(role, screens)`)
- Modificar: `frontend/src/app/app/layout.tsx` (redirecionar)
- Modificar: `frontend/src/app/app/clientes/[id]/page.tsx` (aba Oportunidades só com `crm`; aba Contratos só com `contratos`; aba Ativos só com `ativos`), `frontend/src/app/app/chamados/[id]/page.tsx` (seção Orçamentos só com `orcamentos`)

**Interfaces:**
- Produz, em `screens.ts`:
  - `SCREENS`, a mesma lista do backend (duplicada de propósito, como `integration-template.ts`)
  - `SCREEN_LABELS: Record<ScreenKey, string>`, com os textos do menu atual (`Painel`, `Agenda técnica`, `Triagem WhatsApp`, `Técnico de campo`, `Clientes`, `Parque de ativos`, `Contratos`, `CRM`, `Orçamentos`, `Catálogo de serviços`, `Estoque e peças`, `Base de conhecimento`, `Configurações`)
  - `screenForPath(pathname: string): ScreenKey | null`. Regra por prefixo: `/app/dashboard`→`dashboard`, `/app/agenda`→`agenda`, `/app/triagem`→`triagem`, `/app/campo`→`campo`, `/app/clientes`→`clientes`, `/app/ativos`→`ativos`, `/app/contratos`→`contratos`, `/app/crm`→`crm`, `/app/orcamentos`→`orcamentos`, `/app/catalogo`→`catalogo`, `/app/estoque`→`estoque`, `/app/base-conhecimento`→`base-conhecimento`, `/app/config`→`config`; qualquer outra → `null`
  - `canSee(user: SessionUser | null, key: ScreenKey): boolean`, que dá `!user?.screens || user.screens.includes(key)`
- Layout: se `screenForPath(pathname)` existe e `!canSee` → `router.replace('/app?semAcesso=1')`. Em `/app`, se vier `semAcesso=1`, mostrar o aviso `Sem acesso a esta tela.` (usar o toast/alert que o projeto já tiver).
- Menu: cada link com `href` mapeado por `screenForPath` some quando `!canSee`. Um grupo de menu que fica vazio também some.

- [ ] **Passo 1:** `screens.ts` com um self-check rodável (o projeto não tem unit test no front): `frontend/src/lib/screens.check.ts` com `assert` cobrindo `screenForPath('/app/crm/abc') === 'crm'`, `screenForPath('/app/chamados/1') === null`, `screenForPath('/app') === null`, `canSee({screens:null}, 'crm') === true`, `canSee({screens:['clientes']}, 'crm') === false`. Rodar com `node --experimental-strip-types src/lib/screens.check.ts` (ou `npx tsx`, se já instalado; não adicionar dependência) → sem saída e exit 0.
- [ ] **Passo 2:** sessão, menu, layout e esconder os pontos de entrada.
- [ ] **Passo 3:** `cd frontend && npm run build` → ok.
- [ ] **Passo 4: Commit** `feat(frontend): menu e rotas respeitam telas do grupo`

### Task 5: Front — aba Grupos e grupo na aba Usuários

**Arquivos:**
- Criar: `frontend/src/app/app/config/tabs/groups-tab.tsx`
- Modificar: `frontend/src/app/app/config/page.tsx` (aba `grupos`, label `Grupos`, só para admin pleno: `user.role === 'ADMIN' && !user.groupId`; `UsersTab` ganha a coluna "Grupo" e um `<select>` "Grupo" no formulário e por linha, também só para admin pleno)

**Interfaces:**
- Consome: `/api/user-groups` (Task 1), `PATCH /api/users/:id {groupId}` (Task 3), `SCREENS`/`SCREEN_LABELS` (Task 4).
- Aba Grupos: lista com nome, quantidade de telas e de membros; criar/editar em modal (padrão de cadastro em modal da 0.9.0) com nome + um checkbox por tela; excluir com `confirm()` e o texto exato: `Os {n} membros deste grupo ficarão sem restrição de telas. Excluir mesmo assim?`
- Opção vazia do select de grupo: `Sem grupo (acesso total do papel)`.

- [ ] **Passo 1:** implementar.
- [ ] **Passo 2:** `npm run build` → ok.
- [ ] **Passo 3: Commit** `feat(frontend): aba Grupos e grupo na aba Usuários`

### Task 6: E2E + release 0.21.0

**Arquivos:**
- Criar: `frontend/e2e/grupos-permissoes.spec.ts`
- Modificar: `frontend/e2e/seed-e2e.ts` (grupo e usuário ADMIN restrito; limpeza do `UserGroup` **depois** dos usuários, para não repetir o bug de FK da 0.5.0/0.6.0)
- Modificar: `CHANGELOG.md` (`[0.21.0]`), `backend/package.json` e `frontend/package.json` → `0.21.0`

- [ ] **Passo 1: E2E**: logar como o ADMIN restrito (grupo sem `crm`):
  - o menu não tem o link `CRM`
  - `page.goto('/app/crm')` → URL final `/app` e o texto `Sem acesso a esta tela.` visível
  - `page.goto('/app/crm/qualquer-id')` → mesmo redirecionamento
  - em `/app/chamados/novo`, o seletor de cliente lista os clientes do seed
  - Configurações não mostra a aba `Grupos`
- [ ] **Passo 2:** subir o backend real e rodar `npx playwright test grupos-permissoes` → PASSA; depois a suíte inteira **uma vez** (rate limit de login, lição da 0.6.0) → PASSA.
- [ ] **Passo 3:** CHANGELOG + versões.
- [ ] **Passo 4: Commit** `chore: release 0.21.0 (grupos e permissões por tela)`
