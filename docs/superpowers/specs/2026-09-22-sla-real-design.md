# SLA real (Fase 0.7.0 — parte 3/4)

Data: 2026-09-22
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `2e1feb0` (Dashboard de gestão, 0.7.0 parte 2/4)
Roadmap: `docs/roadmap.md` — 0.7.0 "Gestão, SLA real e satisfação"

## 1. Objetivo

O SLA hoje (0.1.0/0.5.0) só considera prioridade + override opcional por
contrato — não pausa quando o chamado está `WAITING_CLIENT` (aguardando
cliente) e não tem nível de categoria. Isso gera dois problemas reais:
chamado marcado como "vencido" enquanto o próprio sistema está esperando o
cliente responder, e nenhuma forma de dar SLA diferente por tipo de
serviço sem vincular a um contrato.

A fase 0.7.0 do roadmap junta 4 partes pouco acopladas (CSAT, Dashboard,
SLA real, Base de conhecimento) — **esta spec cobre só o SLA real**, a
terceira das quatro sessões, seguindo a mesma decisão das partes
anteriores (CSAT —
`docs/superpowers/specs/2026-09-20-csat-pos-chamado-design.md`; Dashboard
— `docs/superpowers/specs/2026-09-21-dashboard-gestao-design.md`).

Entregas:

1. **Pausa de SLA em `WAITING_CLIENT`**: o prazo (`slaDueAt`) é empurrado
   pra frente pelo tempo total que o chamado passou nesse estado, e
   enquanto pausado o chamado não conta como vencido em nenhum lugar do
   sistema.
2. **SLA por categoria**: nova política de horas por prioridade,
   configurável por categoria, com precedência **Contrato > Categoria >
   Global**.
3. **Reset do aviso de estouro** quando o prazo muda (pausa ou troca de
   prioridade) — pode avisar de novo se estourar de novo.
4. **UI**: painel de SLA por categoria na tela de Categorias
   (`/app/config`), mesmo padrão já usado na ficha do contrato.

Fora de escopo (adiado): SLA por tipo de ativo/cliente; pausa em outros
status além de `WAITING_CLIENT`; alerta antecipado de "quase vencendo"
(hoje só existe o aviso de estouro); histórico/auditoria de pausas
(guardamos só o total acumulado, não cada ciclo individual).

## 2. Decisões travadas (do brainstorm)

- **Pausa = estender o prazo ao sair do estado.** Enquanto `WAITING_CLIENT`,
  `slaDueAt` fica parado (congelado no passado, se já tiver passado) — o
  prazo só é empurrado pra frente quando o chamado *sai* de
  `WAITING_CLIENT`, somando o tempo total que ficou pausado.
  `slaDueAt` continua sendo a fonte única de verdade pra todo consumidor
  existente (cron, listagem, ficha do chamado) — não precisamos ensinar
  cada consumidor a calcular "prazo efetivo" combinando dois campos.
- **Precedência: Contrato > Categoria > Global.** Mesma ordem que já
  existia entre contrato e global (0.5.0); categoria entra no meio, sem
  mexer no comportamento de quem já tinha override de contrato.
- **Reset do aviso de estouro quando o prazo muda** (pausa ou troca de
  prioridade) — mesmo padrão já usado no aviso de vencimento de contrato:
  mudou o prazo, pode avisar de novo se estourar de novo.
- **UI de SLA por categoria vive na tela de Categorias** em
  `/app/config`, não numa tela nova — mesmo padrão de "editar categoria"
  que já existe, com um painel a mais (4 linhas, uma por prioridade, texto
  livre pra horas — vazio = sem override).

## 3. Arquitetura

### 3.1 Schema

```prisma
model Ticket {
  // ...campos existentes
  slaPausedAt DateTime? // não-nulo enquanto o chamado está em WAITING_CLIENT
  slaPausedMs Int       @default(0) // soma de todo tempo pausado em ciclos já concluídos
}

model CategorySlaPolicy {
  categoryId String
  priority   TicketPriority
  hours      Int

  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@id([categoryId, priority])
  @@map("category_sla_policies")
}
```

`slaPausedAt` marca o início da pausa em curso (`null` = não está
pausado). `slaPausedMs` acumula o tempo total já pausado nos ciclos que já
terminaram — necessário pra recalcular `slaDueAt` corretamente se a
prioridade mudar depois de uma pausa (sem isso, trocar a prioridade
"esqueceria" o tempo já pausado). `CategorySlaPolicy` espelha exatamente o
formato de `ContractSlaPolicy` (chave composta categoria+prioridade,
`hours` por linha, linha ausente = sem override pra aquela prioridade).

### 3.2 `SlaService.dueAt` — precedência de 3 níveis

```ts
async dueAt(
  priority: TicketPriority,
  from: Date,
  contractId?: string | null,
  categoryId?: string | null,
): Promise<Date> {
  const hours =
    (contractId && (await this.contractOverride(contractId, priority))) ??
    (categoryId && (await this.categoryOverride(categoryId, priority))) ??
    (await this.globalPolicy(priority));
  return new Date(from.getTime() + hours * 3600_000);
}
```

Cada nível só é consultado se o de cima não tiver override pra aquela
prioridade específica (uma categoria pode ter override só pra `URGENT`,
por exemplo — as demais prioridades caem pro global).

### 3.3 Pausa e retomada

Dois pontos de entrada mudam de status pra/de `WAITING_CLIENT` hoje:
`TicketsService.changeStatus` (mudança manual) e
`resolveClientReply` em `ticket-status.service.ts` (usado por comentário
de cliente e por e-mail inbound — faz `update` direto, não passa por
`changeStatus`). A pausa/retomada precisa estar nos dois lugares.

**Ao entrar em `WAITING_CLIENT`:**

```ts
data.slaPausedAt = new Date();
```

**Ao sair de `WAITING_CLIENT` (pra qualquer outro status, se estava
pausado):**

```ts
const elapsed = Date.now() - ticket.slaPausedAt.getTime();
data.slaPausedAt = null;
data.slaPausedMs = ticket.slaPausedMs + elapsed;
data.slaDueAt = ticket.slaDueAt ? new Date(ticket.slaDueAt.getTime() + elapsed) : null;
data.slaBreachNotifiedAt = null; // prazo mudou, pode avisar de novo se estourar de novo
```

Essa segunda aritmética não depende do `SlaService` (não recalcula do
zero, só desloca o prazo existente) — é replicável em
`resolveClientReply`, que só tem acesso ao `PrismaLike`/`tx`, sem DI.

**Reabertura de chamado terminal com pausa órfã**: se um chamado fechado
tinha `slaPausedAt` não-nulo (ficou pausado antes de fechar, sem nunca
retomar), reabrir (sair de `RESOLVED`/`CLOSED`/`CANCELLED` pra um status
não-terminal) zera `slaPausedAt` **sem** somar `elapsed` — o chamado
estava fechado, não "esperando resposta". Mesmo bloco do `changeStatus`
que já zera `resolvedAt`/`closedAt` na reabertura.

### 3.4 Pontos que passam a levar `categoryId`/`contractId`

- `TicketsService.create` (chamado hoje passa só `contractId`) — passa
  `categoryId` também.
- `TicketsService.createFromQuote` — idem (hoje não passa nenhum dos
  dois).
- `TicketsService.changePriority` — hoje **não passa nem `contractId`**
  (lacuna existente, não introduzida por esta fase) e recalcula
  `slaDueAt` do zero a partir de `ticket.createdAt`. Corrigido nesta
  mesma reescrita: passa `contractId` e `categoryId`, e soma
  `ticket.slaPausedMs` de volta ao resultado — senão trocar a prioridade
  depois de uma pausa perderia o tempo já pausado.
  - Caso especial: se o chamado está pausado **no momento** da troca de
    prioridade, o novo prazo não inclui o tempo da pausa em curso (só as
    pausas já concluídas) — ele é ajustado quando a pausa atual terminar,
    normalmente. Evita duplo cálculo, e o cron já ignora `WAITING_CLIENT`
    de qualquer forma (§3.5), então não há janela de "vencido" incorreto
    nesse meio-tempo.

### 3.5 Exclusão de `WAITING_CLIENT` dos checks de vencido

Como `slaDueAt` fica congelado (possivelmente no passado) durante a
pausa, todo lugar que decide "está vencido?" precisa excluir
`WAITING_CLIENT` além dos status terminais — não porque virou terminal,
mas porque o relógio está parado:

- `backend/src/tasks/sla-breach.cron.ts` — `notIn` de status ganha
  `WAITING_CLIENT` junto dos 3 terminais.
- `backend/src/tickets/tickets.service.ts` — filtro `?overdue=true` do
  `findAll`, idem.
- `backend/src/dashboard/dashboard.service.ts` — só na contagem de
  `tickets.overdue`; a contagem de `tickets.open` (chamados ativos)
  continua contando `WAITING_CLIENT` normalmente, ele está ativo, só não
  "vencendo".
- `frontend/src/lib/tickets.ts` (`isOverdue()`) — idem.

Cada arquivo já tem sua própria constante local de status terminais — não
introduz uma constante compartilhada nova, só adiciona `WAITING_CLIENT`
inline nos 4 pontos que checam "vencido" especificamente (mantendo as
constantes de "terminal" como estão, usadas em outros contextos como
contagem de ativos).

### 3.6 Backend — categorias

`backend/src/categories/categories.service.ts` ganha o mesmo padrão já
usado em `ContractsService` pra `slaOverrides`:

```ts
// create()
data: {
  name: dto.name,
  slaOverrides: dto.slaOverrides?.length
    ? { create: dto.slaOverrides.map((s) => ({ priority: s.priority, hours: s.hours })) }
    : undefined,
}

// update()
if (dto.slaOverrides !== undefined) {
  await this.prisma.categorySlaPolicy.deleteMany({ where: { categoryId: id } });
  if (dto.slaOverrides.length) {
    await this.prisma.categorySlaPolicy.createMany({
      data: dto.slaOverrides.map((s) => ({ categoryId: id, priority: s.priority, hours: s.hours })),
    });
  }
}
```

`findAll`/`update` passam a `include: { slaOverrides: true }`. DTOs
(`create-category.dto.ts`/`update-category.dto.ts`) ganham
`slaOverrides?: CategorySlaItemInput[]`, mesmo shape de
`ContractSlaItemInput`.

### 3.7 Frontend

- `frontend/src/lib/categories.ts` (ou onde já vivem os tipos de
  categoria) — tipo `CategorySlaOverride` + campo `slaOverrides` no
  payload de create/update.
- Tela de Categorias em `/app/config` — painel inline de 4 campos de
  texto (um por prioridade, vazio = sem override), mesmo padrão inline já
  usado em `frontend/src/app/app/contratos/[id]/page.tsx` (não é um
  componente extraído hoje — a categoria replica o mesmo padrão, sem
  introduzir abstração nova).
- `frontend/src/lib/tickets.ts` — `isOverdue()` exclui `WAITING_CLIENT`.

## 4. Erros e casos de borda

- Chamado sem categoria (`categoryId: null`) → pula direto pro nível
  Global, igual hoje.
- Categoria sem override pra uma prioridade específica → cai pro Global
  só nessa prioridade.
- Editar `CategorySlaPolicy` de uma categoria → `deleteMany` +
  `createMany` (substitui tudo), sem diff incremental — mesmo padrão do
  contrato.
- Trocar prioridade com pausa em curso → novo prazo não inclui a pausa
  atual (só pausas já concluídas); ajustado quando a pausa atual
  terminar.
- Chamado fecha/cancela com pausa em curso → `slaPausedAt` fica órfão,
  inofensivo (cron/`isOverdue()` já ignoram status terminal).
- Reabertura de chamado terminal com `slaPausedAt` órfão → zera sem somar
  `elapsed`.
- `slaBreachNotifiedAt` → zera sempre que `slaDueAt` for empurrado pra
  frente (retomada de pausa ou troca de prioridade).
- Categoria excluída → `onDelete: Cascade` remove os overrides junto.
  Categoria inativada (não excluída) → overrides continuam valendo, mesmo
  padrão de contrato inativo.

## 5. Testes

Unit (Vitest):
- `sla.service.spec.ts` — precedência: categoria vence global; contrato
  vence categoria quando os dois têm override pra mesma prioridade; sem
  contrato nem categoria cai no global; categoria com override só em
  algumas prioridades cai no global nas outras.
- `tickets-mutations.spec.ts` — `changeStatus`: pausa ao entrar em
  `WAITING_CLIENT`; retomada soma `elapsed` a `slaDueAt`/`slaPausedMs`,
  zera `slaPausedAt`/`slaBreachNotifiedAt`; reabertura de terminal com
  pausa órfã zera sem somar. `changePriority`: agora passa
  `contractId`/`categoryId` e soma `slaPausedMs` de volta.
- `ticket-status.service.spec.ts` — `resolveClientReply` retoma a pausa
  com o mesmo cálculo (via comentário de cliente e via e-mail inbound).
- `sla-breach.cron.spec.ts` — chamado `WAITING_CLIENT` com `slaDueAt`
  vencido não entra na varredura, mesmo sem estar pausado no momento
  exato do cron (defensivo).
- `categories.service.spec.ts` — create/update com `slaOverrides`
  seguindo o padrão de `contracts.service.spec.ts`.

Integração (Postgres real):
- `categories.integration.spec.ts` (novo) — cria categoria com override,
  abre chamado nela (sem contrato), confere `slaDueAt` calculado com as
  horas da categoria.
- Cenário de pausa: cria chamado, muda pra `WAITING_CLIENT`, espera >0,
  volta pra `IN_PROGRESS`, confere que `slaDueAt` aumentou pelo tempo
  decorrido e `slaPausedAt` voltou a `null`.

E2E Playwright (fumaça): abrir um chamado, mudar status pra "Aguardando
cliente" e voltar, conferir que o prazo mostrado na ficha aumentou.

## 6. Sequência de implementação (rascunho pro plano)

1. Migração: `Ticket.slaPausedAt`/`slaPausedMs` + model
   `CategorySlaPolicy`.
2. `SlaService.dueAt` — parâmetro `categoryId` + testes de precedência.
3. `TicketsService.create`/`createFromQuote` — passam `categoryId` +
   testes.
4. `TicketsService.changeStatus` — pausa/retomada + reabertura com pausa
   órfã + testes.
5. `ticket-status.service.ts` (`resolveClientReply`) — mesma
   retomada + testes.
6. `TicketsService.changePriority` — passa `contractId`/`categoryId` +
   soma `slaPausedMs` + testes.
7. `sla-breach.cron.ts` + `tickets.service.ts` (filtro `overdue`) +
   `dashboard.service.ts` (contagem `overdue`) — excluem
   `WAITING_CLIENT` + testes.
8. `categories.service.ts`/DTOs — CRUD de `slaOverrides` + testes.
9. Integração (categoria + pausa) + CHANGELOG.
10. Frontend: `isOverdue()` exclui `WAITING_CLIENT`; painel de SLA na
    tela de Categorias.
11. Frontend: E2E de pausa.
12. Release — sem bump de versão nem tag (fecha quando as 4 partes da
    0.7.0 estiverem prontas).

## 7. Versão

Ainda sem tag — continua parte da fase 0.7.0 em andamento (`[Não
lançado]` no CHANGELOG, sem bump de versão). Nenhuma env nova.
