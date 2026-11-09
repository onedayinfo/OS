# Inventário de PCs — Fase 1 (servidor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O OS recebe, por HTTPS e sem login de usuário, a identificação e o inventário de PCs de clientes com contrato, coloca PCs novos numa fila de cadastro e permite aprovar/vincular/ignorar, tudo testável com `curl` (sem o agente Windows).

**Architecture:** Novo módulo NestJS `backend/src/agent/` com dois lados: rotas públicas `/agent/enroll` e `/agent/checkin` (autenticadas por código do cliente e token do dispositivo, não por JWT) e rotas de gestão (JWT, `ADMIN`/`AGENT`). Um `AgentDevice` é a fila e o vínculo; ao vincular, o servidor copia dados técnicos para o `Asset` sem tocar nos campos humanos. Frontend: aba "Agente" na ficha do cliente e página da fila.

**Tech Stack:** NestJS 12 + Prisma 6 + class-validator, Vitest (unit `npm test`, integração `npm run test:integration` com Postgres real), Next.js + React Query (`api()` de `frontend/src/lib/api.ts`), Playwright já existente.

**Spec:** `docs/superpowers/specs/2026-11-08-inventario-agente-design.md` (fases 2 e 3 — agente, MSI, uptime, regras de melhoria — ficam fora deste plano).

## Global Constraints

- Mensagens de erro e textos de UI em **português do Brasil**.
- Contrato "vale" = cliente com ao menos um `Contract` `status = ACTIVE` e `endDate >= hoje`. Enroll e checkin sem contrato válido → **403**.
- Teto de **50 dispositivos `PENDING` por cliente**; acima disso o enroll recusa.
- `IGNORED` **revoga o token**: checkin de dispositivo `IGNORED` → 403; enroll de dispositivo `IGNORED` → 403 (continua ignorado).
- O agente **nunca sobrescreve** `Asset.label`, `description`, `assignedTo`, `notes`, `locationId`, `status`. Atualiza `specs`, `lastSeenAt`, `ip`, `mac`; `brand`/`model`/`serialNumber` **só se vazios** no ativo.
- Identidade: `(clientId, machineGuid, serialKey)`; serial inválido ("To be filled by O.E.M.", vazio…) = ausente.
- Código de instalação do cliente: **32 caracteres hex** (16 bytes aleatórios; ajuste do spec §3, que dizia 32 bytes). Token do dispositivo: 32 bytes hex, guardado só como hash SHA-256.
- Servidor **nunca** manda comando ao PC (fora do escopo desta fase: nem update).
- "Sem contato" = `lastSeenAt` nulo ou há mais de **30 dias**.
- Papéis das rotas de gestão: `@Roles('ADMIN', 'AGENT')`. Rotas do agente: `@Public()`.

## Review Focus

1. Checkin de dispositivo de cliente sem contrato válido, ou `IGNORED`: 403 e **nada** é gravado.
2. Sincronizar com o ativo não pode apagar/alterar `label`, `description`, `assignedTo`, `notes`, `locationId`, `status` (Task 5 pina isso).
3. Serial placeholder ("To be filled by O.E.M.") não vira `Asset.serialNumber`, não dispara "possível clone" nem sugestão de vínculo (Task 4).
4. Aprovar o mesmo dispositivo duas vezes (duplo clique) cria **um** ativo só (Task 6).
5. Serial vindo do agente que já existe em outro ativo do cliente (P2002) não derruba o checkin (Task 5).
6. Código de instalação errado/regenerado responde igual (401) sem revelar se o cliente existe (Task 4).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `backend/prisma/schema.prisma` + migration | `AgentDevice`, `AgentDeviceStatus`, campos novos em `Asset`/`Client` |
| `backend/src/agent/serial.util.ts` | `normalizeSerial` |
| `backend/src/agent/match-device.util.ts` | `matchDevice` (regra de identidade/clone) |
| `backend/src/agent/token.util.ts` | `newToken`, `hashToken` |
| `backend/src/agent/contract-gate.service.ts` | `ContractGate.hasValidContract` |
| `backend/src/agent/agent-code.service.ts` + `client-agent.controller.ts` | código do cliente, resumo da aba |
| `backend/src/agent/agent.service.ts` + `agent.controller.ts` | enroll/checkin públicos |
| `backend/src/agent/asset-sync.ts` | copia dados do dispositivo para o `Asset` |
| `backend/src/agent/agent-devices.service.ts` + `agent-devices.controller.ts` | lista/aprovação/vínculo/ignorar |
| `backend/src/agent/dto/*.ts` | DTOs |
| `frontend/src/lib/agent.ts`, `components/client-agent-tab.tsx`, `app/app/ativos/fila/page.tsx` | UI |

---

### Task 1: Schema e migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (`Asset` ~l.578, `Client`)
- Create: `backend/prisma/migrations/20261108120000_agent_inventory/migration.sql` (gerada)

**Interfaces:**
- Produces: enum `AgentDeviceStatus { PENDING LINKED IGNORED }`; model `AgentDevice` com campos `id, clientId, machineGuid, serialKey (default ""), hostname, serialNumber?, manufacturer?, model?, ip?, mac?, status (default PENDING), cloneSuspect Boolean (default false), assetId? @unique, tokenHash @unique, agentVersion?, firstSeenAt, lastSeenAt?, specs Json?, software Json?, inventoryAt?, createdAt, updatedAt`; `@@unique([clientId, machineGuid, serialKey])`, `@@index([clientId, status])`, `@@map("agent_devices")`; relações `client`, `asset?`. `Asset` ganha `description String?`, `assignedTo String?`, `specs Json?`, `lastSeenAt DateTime?`, `agentDevice AgentDevice?`. `Client` ganha `agentEnrollCode String? @unique` e `agentDevices AgentDevice[]`.

- [ ] **Step 1:** Editar o schema conforme Interfaces.
- [ ] **Step 2:** `cd backend && npx prisma migrate dev --name agent_inventory` (Postgres no ar via `docker compose up -d postgres`). Esperado: migration criada, client regenerado, sem erro.
- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json` → sem erros.
- [ ] **Step 4:** Commit: `feat(agent): schema do inventário de PCs (AgentDevice) (0.15.0)`.

---

### Task 2: Responsável e descrição do ativo (ponta a ponta)

**Files:**
- Modify: `backend/src/assets/dto/create-asset.dto.ts`, `update-asset.dto.ts`, `assets.service.ts` (`buildWrite`), `assets.service.spec.ts`
- Modify: `frontend/src/lib/assets.ts` (`Asset`: `description`, `assignedTo`, `lastSeenAt`), `frontend/src/components/asset-form.tsx`, `frontend/src/app/app/ativos/[id]/page.tsx`, `frontend/src/app/app/ativos/page.tsx` (coluna "Responsável")

**Interfaces:**
- Produces: `CreateAssetDto`/`UpdateAssetDto` aceitam `description?: string` e `assignedTo?: string` (vazio → `null`); a API de ativos devolve `description`, `assignedTo`, `lastSeenAt`.

- [ ] **Step 1: Teste** em `assets.service.spec.ts`: `'create grava responsável e descrição, e string vazia vira null'` — `create({... assignedTo: 'Maria – financeiro', description: ''})` → `prisma.asset.create` recebe `assignedTo: 'Maria – financeiro'` e `description: null`.
- [ ] **Step 2:** `cd backend && npx vitest run src/assets/assets.service.spec.ts` → FAIL.
- [ ] **Step 3:** DTOs (`@IsOptional() @IsString() @MaxLength(200)` p/ `assignedTo`, `500` p/ `description`) e `buildWrite` seguindo o padrão de `notes`.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Frontend: campos "Responsável" e "Descrição" no `asset-form.tsx` (padrão dos demais campos de texto), exibidos no detalhe e "Responsável" como coluna na lista.
- [ ] **Step 6:** `cd frontend && npx tsc --noEmit` → sem erros. Commit: `feat(ativos): responsável e descrição do ativo (0.15.0)`.

---

### Task 3: Contrato válido e código de instalação do cliente

**Files:**
- Create: `backend/src/agent/contract-gate.service.ts`, `agent-code.service.ts`, `client-agent.controller.ts`, `agent.module.ts` (registrar em `backend/src/app.module.ts`), specs `contract-gate.service.spec.ts`, `agent-code.service.spec.ts`

**Interfaces:**
- Produces: `ContractGate.hasValidContract(clientId: string, now?: Date): Promise<boolean>`; `AgentCodeService.summary(clientId: string): Promise<{ code: string | null; contractValid: boolean; counts: { linked: number; pending: number; ignored: number; stale: number } }>`; `AgentCodeService.regenerate(clientId: string): Promise<{ code: string }>` (32 hex, `randomBytes(16)`); `AgentCodeService.clientByCode(code: string): Promise<{ id: string } | null>`.
- Rotas (`@Roles('ADMIN','AGENT')`): `GET /clients/:clientId/agent` → `summary`; `POST /clients/:clientId/agent/code` → `regenerate` (cliente inexistente → 404 "Cliente não encontrado.").

- [ ] **Step 1: Testes** (mock de prisma como em `assets.service.spec.ts`): (a) `hasValidContract` consulta `contract.count` com `status: 'ACTIVE'` e `endDate: { gte: now }` e devolve `count > 0`; (b) `regenerate` devolve `/^[0-9a-f]{32}$/` e grava em `client.update`; (c) `summary.counts.stale` conta `LINKED` com `lastSeenAt` nulo ou anterior a 30 dias.
- [ ] **Step 2:** `npx vitest run src/agent` → FAIL.
- [ ] **Step 3:** Implementar. `summary` usa `agentDevice.groupBy`/`count` por status e um `count` de `LINKED` com `OR [{lastSeenAt:null},{lastSeenAt:{lt: now-30d}}]`.
- [ ] **Step 4:** `npx vitest run src/agent` → PASS; `npx tsc --noEmit -p tsconfig.json` → ok.
- [ ] **Step 5:** Commit: `feat(agent): código de instalação por cliente e regra de contrato (0.15.0)`.

---

### Task 4: Enroll público

**Files:**
- Create: `backend/src/agent/serial.util.ts`, `match-device.util.ts`, `token.util.ts`, `agent.service.ts`, `agent.controller.ts`, `dto/enroll.dto.ts`, specs correspondentes
- Modify: `backend/src/common/rate-limit.ts` (limite do enroll), `backend/src/main.ts` (limite de corpo de `/api/agent` em 2 MB, para o inventário da Task 5; conferir o parser atual)

**Interfaces:**
- Produces:
  - `normalizeSerial(raw: string | null | undefined): string | null` — `null` para vazio, só espaços, caracteres todos iguais, ou placeholders (`to be filled by o.e.m.`, `default string`, `system serial number`, `none`, `n/a`, `0`), comparação sem caixa; senão o serial aparado.
  - `matchDevice(existing: { id: string; serialKey: string }[], serialKey: string): { kind: 'match' | 'adopt'; id: string } | { kind: 'clone' | 'new' }` — `match`: mesma chave, ou `serialKey === ''` e existe um com serial (usa o existente); `adopt`: existe um com `serialKey ''` e o novo tem serial (adota o serial); `clone`: já há dispositivo(s) do mesmo `machineGuid` e todos com serial válido **diferente**; `new`: nenhum do `machineGuid`.
  - `newToken(): { token: string; hash: string }`; `hashToken(token: string): string` (SHA-256 hex).
  - `EnrollDto { code, machineGuid, hostname, serialNumber?, manufacturer?, model?, ip?, mac?, agentVersion? }` (strings, `code` 32 hex, `machineGuid` 1–64).
  - `AgentService.enroll(dto: EnrollDto): Promise<{ token: string; status: AgentDeviceStatus }>`; rota pública `POST /agent/enroll`.

- [ ] **Step 1: Testes puros:** `normalizeSerial('To be filled by O.E.M.')`, `'  '`, `'0000000'`, `'None'` → `null`; `' ABC123 '` → `'ABC123'`. `matchDevice([], 'X')` → `new`; `([{id:'1',serialKey:'X'}],'X')` → `match 1`; `([{id:'1',serialKey:'X'}],'Y')` → `clone`; `([{id:'1',serialKey:''}],'Y')` → `adopt 1`; `([{id:'1',serialKey:'X'}],'')` → `match 1`.
- [ ] **Step 2: Testes do `enroll`** (mock de prisma): código desconhecido → `UnauthorizedException('Código de instalação inválido.')`; sem contrato válido → `ForbiddenException('O cliente não possui contrato ativo.')`; cria `PENDING` com `tokenHash` (nunca o token) e devolve o token em claro; com 50 `PENDING` → `ConflictException('Limite de dispositivos aguardando cadastro atingido.')`; `clone` cria novo dispositivo com `cloneSuspect: true`; dispositivo existente `IGNORED` → `ForbiddenException('Dispositivo ignorado.')`; reenroll do mesmo dispositivo gera **novo** token e invalida o antigo (hash trocado).
- [ ] **Step 3:** `npx vitest run src/agent` → FAIL.
- [ ] **Step 4:** Implementar utils, DTO, serviço e controller (`@Public()`, `@Controller('agent')`). Gravar `serialKey = normalizeSerial(dto.serialNumber) ?? ''` e `serialNumber` com o valor normalizado.
- [ ] **Step 5:** Rate limit: `app.use('/api/agent/enroll', rateLimit({ ...base, max: 30 }))` em `setupRateLimit` (escritório instalando vários PCs atrás do mesmo IP); `rate-limit.spec.ts` ganha um caso para a rota.
- [ ] **Step 6:** `npx vitest run src/agent src/common` → PASS. Commit: `feat(agent): enroll público de dispositivos (0.15.0)`.

---

### Task 5: Checkin e sincronização com o ativo

**Files:**
- Create: `backend/src/agent/asset-sync.ts`, `dto/checkin.dto.ts`, specs
- Modify: `backend/src/agent/agent.service.ts`, `agent.controller.ts`

**Interfaces:**
- Consumes: `hashToken`, `ContractGate.hasValidContract` (Tasks 3–4).
- Produces:
  - `CheckinDto { hostname: string; serialNumber?; manufacturer?; model?; ip?; mac?; agentVersion?; inventory?: { specs: Record<string, unknown>; software: { name: string; version?: string; publisher?: string }[] } }` (software ≤ 3000 itens).
  - `AgentService.checkin(token: string, dto: CheckinDto): Promise<{ status: AgentDeviceStatus; wantInventory: boolean }>` — `wantInventory` = `inventoryAt` nulo ou mais antigo que 24 h (calculado **depois** de gravar um inventário recebido).
  - `syncAsset(prisma: PrismaService, deviceId: string): Promise<void>` — para dispositivo `LINKED`, atualiza o `Asset` conforme Global Constraints.
  - Rota pública `POST /agent/checkin` com `Authorization: Bearer <token>` (ausente/inválido → 401 "Token inválido.").

- [ ] **Step 1: Testes do `checkin`:** token inexistente → 401; `IGNORED` → 403 e **nenhum** `update`; cliente sem contrato → 403 e nenhum `update`; checkin sem inventário atualiza `lastSeenAt`/`hostname`/`agentVersion` e responde `wantInventory: true` quando nunca recebeu inventário; com inventário grava `specs`, `software`, `inventoryAt` e responde `wantInventory: false`.
- [ ] **Step 2: Testes do `syncAsset`:** com ativo cujo `label`, `description`, `assignedTo`, `notes`, `locationId`, `status` estão preenchidos, o `asset.update` **não** recebe nenhum desses campos; `brand`/`model`/`serialNumber` só entram quando o ativo os tem vazios; um erro `P2002` em `asset.update` (serial duplicado) é engolido e repetido sem `serialNumber`.
- [ ] **Step 3:** `npx vitest run src/agent` → FAIL.
- [ ] **Step 4:** Implementar. Dispositivo `LINKED` chama `syncAsset` após gravar; `PENDING` só grava no próprio `AgentDevice`.
- [ ] **Step 5:** `npx vitest run src/agent` → PASS. Commit: `feat(agent): checkin e sincronização com o ativo (0.15.0)`.

---

### Task 6: Gestão da fila (lista, aprovar, vincular, ignorar)

**Files:**
- Create: `backend/src/agent/agent-devices.service.ts`, `agent-devices.controller.ts`, `dto/approve-device.dto.ts`, `dto/list-devices.dto.ts`, `dto/link-device.dto.ts`, specs

**Interfaces:**
- Consumes: `AssetsService.create` (valida local⊂cliente e tipo), `syncAsset` (Task 5).
- Produces (rotas `@Roles('ADMIN','AGENT')`, `@Controller('agent-devices')`):
  - `GET /agent-devices?clientId&status&page&pageSize` → itens com `client {id,name}`, e para `PENDING` com serial válido `suggestedAsset: { id, label } | null` (ativo do mesmo cliente com o mesmo `serialNumber`).
  - `GET /agent-devices/:id` → inclui `specs` e `software`.
  - `POST /agent-devices/:id/approve` body `ApproveDeviceDto { locationId, typeId, label, assignedTo?, description?, notes? }` → cria o `Asset` com brand/model/serial/ip/mac do dispositivo, marca `LINKED`, chama `syncAsset`, devolve o ativo.
  - `POST /agent-devices/:id/link` body `{ assetId }` → ativo precisa ser do mesmo cliente e não ter outro dispositivo; marca `LINKED` e sincroniza.
  - `POST /agent-devices/:id/ignore` e `POST /agent-devices/:id/restore` (`IGNORED`→`PENDING`).
- Aprovar/vincular só aceitam `PENDING` (senão 409 "Dispositivo já tratado."). Reivindicar com `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'LINKED' } })` antes de criar o ativo; se `count === 0` → 409; se criar o ativo falhar, volta para `PENDING`.

- [ ] **Step 1: Testes:** `approve` cria ativo com `label` informado e copia `serialNumber`; segundo `approve` do mesmo dispositivo → 409 e **um** `asset.create`; `approve` com serial já usado por outro ativo → propaga erro de `AssetsService` e o dispositivo volta a `PENDING`; `link` em ativo de outro cliente → 400 "O ativo não pertence ao mesmo cliente."; `link` em ativo já vinculado → 409; `ignore` de `LINKED` → 409; `list` devolve `suggestedAsset` só para `PENDING` com serial válido (serial placeholder → `null`).
- [ ] **Step 2:** `npx vitest run src/agent` → FAIL.
- [ ] **Step 3:** Implementar service + controller; registrar no `agent.module.ts` (importa `AssetsModule`).
- [ ] **Step 4:** `npx vitest run src/agent` e `npx tsc --noEmit -p tsconfig.json` → ok. Commit: `feat(agent): fila de cadastro — aprovar, vincular e ignorar (0.15.0)`.

---

### Task 7: Integração ponta a ponta no backend

**Files:**
- Create: `backend/src/agent/agent.integration.spec.ts` (padrão de `assets.integration.spec.ts`: Postgres real, `PFX`, limpeza, pula sem `DATABASE_URL`)

- [ ] **Step 1: Teste** do fluxo: cliente com contrato `ACTIVE` + `regenerate` → `enroll` (PENDING) → `checkin` com inventário → lista mostra `PENDING` com `specs` → `approve` com local/tipo → `GET /assets/:id` traz `lastSeenAt`, `specs`, `assignedTo` sem o agente ter alterado `label` → novo `checkin` muda `ip` mas não `label` → contrato `CANCELLED` → `checkin` 403. Outro caso: dois enrolls com o mesmo `machineGuid` e seriais válidos diferentes → segundo fica `cloneSuspect: true`.
- [ ] **Step 2:** `docker compose up -d postgres && cd backend && npm run test:integration -- agent` → PASS.
- [ ] **Step 3:** Commit: `test(agent): integração do fluxo enroll→aprovar→checkin (0.15.0)`.

---

### Task 8: Frontend — aba "Agente" na ficha do cliente

**Files:**
- Create: `frontend/src/lib/agent.ts`, `frontend/src/components/client-agent-tab.tsx`
- Modify: `frontend/src/app/app/clientes/[id]/page.tsx` (nova aba `agente` ao lado de WhatsApp/Contratos)

**Interfaces:**
- Produces (`lib/agent.ts`): tipos `AgentDeviceStatus`, `AgentDevice`, `ClientAgentSummary { code: string | null; contractValid: boolean; counts: { linked: number; pending: number; ignored: number; stale: number } }` e `AGENT_STATUS_LABELS` (`PENDING: 'Aguardando cadastro'`, `LINKED: 'Vinculado'`, `IGNORED: 'Ignorado'`).
- `ClientAgentTab({ clientId }: { clientId: string })`: mostra aviso "Cliente sem contrato ativo" quando `!contractValid`; contadores; o código com botão copiar e "Gerar novo código" (confirmação: "Instalações novas com o código antigo deixam de funcionar; PCs já instalados continuam."); link para a fila filtrada por cliente. Sem botão de baixar instalador (fase 2).

- [ ] **Step 1:** Implementar seguindo `whatsapp-client-tab.tsx` (React Query + `api()`, `toast`, `errToast`).
- [ ] **Step 2:** `cd frontend && npx tsc --noEmit` → ok; abrir a aba num cliente de teste com `npm run dev` e conferir que gerar código atualiza o valor mostrado.
- [ ] **Step 3:** Commit: `feat(agent): aba Agente na ficha do cliente (0.15.0)`.

---

### Task 9: Frontend — fila de cadastro

**Files:**
- Create: `frontend/src/app/app/ativos/fila/page.tsx`, `frontend/src/components/agent-approve-dialog.tsx`
- Modify: `frontend/src/app/app/ativos/page.tsx` (botão "Fila de cadastro (N)" com a contagem de `PENDING`)
- Test: `frontend/e2e/agent-fila.spec.ts` (padrão dos e2e existentes; sobe com `seed-e2e.ts`)

**Interfaces:**
- Consumes: rotas da Task 6, tipos da Task 8.
- `AgentApproveDialog`: campos local (do cliente do dispositivo), tipo (pré-seleciona o tipo de nome "Computador" se existir), nome (vem do hostname), responsável, descrição, observação; se houver `suggestedAsset`, mostra "Já existe o ativo *X* com este serial — vincular" como ação principal; marca "possível clone" quando `cloneSuspect`. Ações da linha: Aprovar, Vincular a existente (select de ativos do cliente), Ignorar; filtro "Ignorados" com "Restaurar".

- [ ] **Step 1: e2e:** cria dispositivo `PENDING` via `POST /api/agent/enroll` (com o código gerado pela API do cliente semeado), abre `/app/ativos/fila`, aprova com um local e confirma que o ativo aparece em `/app/ativos` com o nome informado.
- [ ] **Step 2:** `cd frontend && npx playwright test e2e/agent-fila.spec.ts` → FAIL.
- [ ] **Step 3:** Implementar página, diálogo e botão.
- [ ] **Step 4:** Mesmo comando → PASS; `npx tsc --noEmit` ok. Commit: `feat(agent): tela da fila de cadastro (0.15.0)`.

---

### Task 10: Fechamento da fase

**Files:**
- Modify: `CHANGELOG.md` (entrada `## [0.15.0] - 2026-11-08`, em "Adicionado": fila de cadastro de PCs, aba Agente, responsável/descrição do ativo; nota de que o agente Windows vem na próxima fase)
- Modify: `docs/superpowers/specs/2026-11-08-inventario-agente-design.md` (§3: código do cliente = 32 caracteres hex; `serialKey` na chave de identidade; §11 marcar fase 1 como feita)

- [ ] **Step 1:** Rodar tudo: `cd backend && npm test && npm run lint && npx tsc --noEmit -p tsconfig.json && npm run test:integration`; `cd ../frontend && npx tsc --noEmit && npx playwright test`. Esperado: tudo verde.
- [ ] **Step 2:** Smoke manual com `curl`: `POST /api/agent/enroll` com o código de um cliente de teste → token; `POST /api/agent/checkin` com o token → `{status:"PENDING",wantInventory:true}`.
- [ ] **Step 3:** Commit: `docs: changelog 0.15.0 e spec do inventário (fase 1)`. Deploy (bump de `OS_TAG` e imagens) só com confirmação do usuário.
