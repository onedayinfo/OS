# Dashboard de gestão (Fase 0.7.0 — parte 2/4)

Data: 2026-09-21
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `b1e3a48` (CSAT pós-chamado, 0.7.0 parte 1/4)
Roadmap: `docs/roadmap.md` — 0.7.0 "Gestão, SLA real e satisfação"

## 1. Objetivo

Dar visão gerencial do mês corrente num painel só: chamados
abertos/vencidos, tempo médio de atendimento, produtividade por técnico,
recorrente vs avulso, contratos com franquia estourada, e margem por
chamado avulso.

A fase 0.7.0 do roadmap junta 4 partes pouco acopladas (CSAT, Dashboard,
SLA real, Base de conhecimento) — **esta spec cobre só o Dashboard**, a
segunda das quatro sessões, seguindo a mesma decisão da parte 1
(CSAT — `docs/superpowers/specs/2026-09-20-csat-pos-chamado-design.md`).

Entregas:

1. **`GET /dashboard/overview`** — endpoint único devolvendo todas as
   métricas do mês civil corrente (UTC), sem parâmetro de período.
2. **Chamados**: contagem de abertos, vencidos (SLA estourado e ainda não
   resolvido/fechado), recorrentes (com contrato) e avulsos criados no mês.
3. **Tempo médio de atendimento**: média de `resolvedAt - createdAt` dos
   chamados resolvidos no mês.
4. **Produtividade por técnico**: chamados resolvidos + horas trabalhadas
   (soma de `laborEndAt - laborStartAt` das visitas) no mês, só de quem
   teve atividade.
5. **Contratos com franquia estourada**: lista dos contratos ativos que já
   passaram do limite no mês (reaproveita `ContractsService.consumption`).
6. **Margem por chamado**: receita (itens de orçamento aprovado no mês)
   menos custo de material usado, agregada — total e média por chamado.
7. **Frontend** `/app/dashboard` — cards de KPI + duas tabelas.

Fora de escopo (adiado): seletor de período (sempre mês civil corrente);
custo de mão de obra na margem (não existe valor-hora de técnico no
sistema — ver §2); margem para chamados de contrato (sem preço por
chamado, só mensalidade); exportação/relatório em PDF; gráficos/série
histórica (só o mês corrente, sem comparação com meses anteriores); SLA
"de verdade" com pausa em aguardando cliente (fica pra próxima sessão,
"SLA real").

## 2. Decisões travadas (do brainstorm)

- **Margem por chamado = receita do orçamento aprovado menos custo de
  material usado**, sem custo de mão de obra (não existe valor-hora de
  técnico modelado em lugar nenhum do sistema hoje — adicionar isso agora
  seria escopo novo, não parte do dashboard). Só chamados **avulsos com
  orçamento aprovado** entram nessa métrica; chamados de contrato não têm
  preço por chamado (o contrato já cobra mensalidade), então ficam de fora.
- **Sem model novo.** O módulo é só leitura/agregação sobre `Ticket`,
  `Visit`, `Contract`, `Quote`, `QuoteItem`, `TicketMaterialUsage` — todos
  já existentes.
- **Período fixo: mês civil corrente (UTC)**, sem seletor de data nesta
  fase — mesmo padrão já usado no consumo de franquia da 0.5.0.
- **Acesso: `ADMIN` e `AGENT`**, mesmo padrão já usado em
  Contratos/Catálogo/Orçamentos. `MANAGER` não entra — hoje esse papel não
  tem acesso a nenhum dado agregado/financeiro em lugar nenhum do sistema,
  e não é o escopo desta fase mudar isso.
- **Produtividade por técnico**: chamados resolvidos (`assigneeId` =
  técnico, `resolvedAt` no mês) **+** horas trabalhadas (soma de
  `laborEndAt - laborStartAt` das visitas do técnico no mês). Só aparecem
  técnicos com alguma atividade no mês — não lista todo `AGENT` cadastrado.
- **Tempo médio de atendimento = `resolvedAt - createdAt`** dos chamados
  resolvidos no mês corrente. Sem métrica adicional de primeira resposta
  nesta fase.
- **Contratos com franquia estourada**: só os que já excederam
  (`exceeded: true`), não a lista completa de todo contrato ativo —
  informação acionável, sem inflar o payload com contratos dentro do
  normal.
- **Reconhecimento de receita/custo pelo mês do orçamento aprovado**: se o
  material foi lançado num mês diferente do mês em que o orçamento foi
  aprovado, o custo entra no mês da aprovação (mês em que a receita é
  reconhecida) — evita custo "vazando" sem receita correspondente na
  mesma métrica.
- **Um orçamento aprovado por chamado, na prática**: revisar supera a
  versão anterior (`SUPERSEDED`), então cada chamado tem no máximo um
  `Quote` com `status: APPROVED` num dado momento — a métrica de margem
  não precisa lidar com múltiplos orçamentos aprovados simultâneos pro
  mesmo chamado.

## 3. Arquitetura

### 3.1 Sem alteração de schema

Nenhum model novo, nenhuma migração. Todo dado já existe:
`Ticket.{status,slaDueAt,contractId,createdAt,resolvedAt,assigneeId}`,
`Visit.{technicianId,laborStartAt,laborEndAt,status}`,
`Contract.{status,franchiseUnit,franchiseAmount}` (via
`ContractsService.consumption`), `Quote.{status,approvedAt,ticketId}`,
`QuoteItem.{quantity,unitPrice}`, `TicketMaterialUsage.{quantity,unitCost,ticketId}`.

### 3.2 Backend — módulo `dashboard`

```
backend/src/
  dashboard/
    dashboard.module.ts
    dashboard.service.ts       # overview() + métodos privados por bloco
    dashboard.controller.ts
    dashboard.service.spec.ts
```

`DashboardModule` importa `ContractsModule` (reaproveita
`ContractsService.consumption`). Sem migração, sem DTO de entrada (o
endpoint não recebe parâmetros).

### 3.3 Rota

- `GET /dashboard/overview` — `@Roles('ADMIN', 'AGENT')`. Sem query params.
  Devolve o payload completo (shape no §3.4).

### 3.4 `DashboardService.overview()`

```ts
interface DashboardOverview {
  period: { start: string; end: string }; // ISO, limites do mês corrente UTC
  tickets: {
    open: number;
    overdue: number;
    recurring: number;
    standalone: number;
  };
  avgResolutionHours: number | null;
  technicianProductivity: Array<{
    technicianId: string;
    name: string;
    ticketsResolved: number;
    hoursWorked: number;
  }>;
  contractsExceeded: Array<{
    contractId: string;
    name: string;
    clientName: string;
    unit: 'VISITS' | 'HOURS';
    used: number;
    franchiseAmount: number;
  }>;
  margin: {
    ticketsCount: number;
    totalRevenue: number;
    totalMaterialCost: number;
    totalMargin: number;
    avgMarginPerTicket: number | null;
  };
}
```

Cálculo por bloco (todos usando os mesmos limites `monthStart`/`monthEnd`,
UTC, primeiro e último instante do mês corrente):

- **`tickets.open`**: `count` de `Ticket` com `status` fora de
  `[RESOLVED, CLOSED, CANCELLED]` — sem filtro de data (é um retrato do
  agora, não do mês).
- **`tickets.overdue`**: dos abertos acima, `slaDueAt < now()`.
- **`tickets.recurring`** / **`tickets.standalone`**: `count` de `Ticket`
  com `createdAt` no mês, particionado por `contractId != null` /
  `contractId == null`.
- **`avgResolutionHours`**: média de `(resolvedAt - createdAt)` em horas
  dos `Ticket` com `resolvedAt` no mês corrente. `null` se nenhum.
- **`technicianProductivity`**: `groupBy assigneeId` de `Ticket` com
  `resolvedAt` no mês (conta) **+** `groupBy technicianId` de `Visit` com
  `laborStartAt`/`laborEndAt` preenchidos e `laborStartAt` no mês (soma de
  horas) — os dois agrupamentos são mesclados por `technicianId`/`assigneeId`
  (mesmo `User.id`); nomes vêm de `User.name`.
- **`contractsExceeded`**: `ContractsService.findAll({ status: 'ACTIVE' })`
  (já devolve `consumption` embutido, ver 0.5.0) filtrando
  `consumption.exceeded === true`.
- **`margin`**: `Quote.findMany({ status: 'APPROVED', approvedAt: { gte: monthStart, lte: monthEnd } }, include: { items: true })` →
  `totalRevenue = Σ item.quantity * item.unitPrice`; pra cada
  `quote.ticketId`, soma `TicketMaterialUsage` desse ticket
  (`Σ usage.quantity * usage.unitCost`) → `totalMaterialCost`;
  `totalMargin = totalRevenue - totalMaterialCost`;
  `avgMarginPerTicket = totalMargin / ticketsCount` (`null` se
  `ticketsCount === 0`).

### 3.5 Frontend

**Navegação**: item **Dashboard** em `/app/dashboard`, primeiro item do
nav (`ADMIN`,`AGENT`).

**`/app/dashboard`**:
- 4 cards de KPI no topo: Chamados abertos, Chamados vencidos, Tempo médio
  de atendimento (formatado em horas/dias), Margem do mês (total).
- Card/linha: Recorrente vs avulso (dois números lado a lado).
- Tabela **Produtividade por técnico**: nome, chamados resolvidos, horas
  trabalhadas.
- Tabela **Contratos com franquia estourada**: cliente, contrato, uso
  (`used/franchiseAmount unit`) — vazia com mensagem "Nenhum contrato
  excedido este mês" se a lista vier vazia.

## 4. Erros e bordas

- Mês sem chamado resolvido → `avgResolutionHours: null` (distingue "sem
  dado" de "resolveu tudo instantaneamente").
- Mês sem orçamento aprovado → `margin` inteiro zerado
  (`ticketsCount: 0`, `avgMarginPerTicket: null`).
- Técnico sem visita nem chamado resolvido no mês → não aparece em
  `technicianProductivity`.
- Chamado com orçamento aprovado mas sem `TicketMaterialUsage` → contribui
  custo `0` (margem = receita cheia).
- Chamado com `TicketMaterialUsage` cujo orçamento foi **rejeitado**
  (nunca `APPROVED`) → fora de `margin` (nem receita nem custo — sem
  receita conhecida pra ele).
- Material lançado num mês diferente do mês de aprovação do orçamento →
  custo contado no mês da aprovação (mês de reconhecimento da receita),
  não no mês do lançamento.
- Contrato cancelado (`status != ACTIVE`) nunca aparece em
  `contractsExceeded`, mesmo que tivesse excedido antes de cancelar.
- Banco vazio (sistema novo) → `GET /dashboard/overview` devolve tudo
  zerado/vazio, nunca `500`.

## 5. Testes

Unit (Vitest):
- `DashboardService.overview` — cada bloco isolado com fixtures via
  Prisma mockado: `tickets.open/overdue/recurring/standalone` com status e
  `contractId` variados; `avgResolutionHours` com 0/1/N chamados
  resolvidos; `technicianProductivity` mesclando corretamente os dois
  agrupamentos e ignorando técnico sem atividade; `contractsExceeded`
  filtrando só `exceeded: true`; `margin` cruzando `QuoteItem` com
  `TicketMaterialUsage` do `ticketId` certo e ignorando orçamento não
  aprovado.

Integração (Postgres real): cenário único — 1 cliente, 1 chamado avulso
com orçamento aprovado + material usado, 1 chamado de contrato, 1
contrato com franquia estourada, 1 visita com horas apontadas →
`overview()` devolve os 5 blocos com os números certos.

E2E Playwright (fumaça): logar como ADMIN, abrir `/app/dashboard`,
conferir que os cards e as duas tabelas renderizam sem erro.

## 6. Sequência de implementação (rascunho pro plano)

1. `DashboardService` — bloco `tickets` (open/overdue/recurring/standalone)
   + testes.
2. `DashboardService` — `avgResolutionHours` + testes.
3. `DashboardService` — `technicianProductivity` + testes.
4. `DashboardService` — `contractsExceeded` + testes.
5. `DashboardService` — `margin` + testes.
6. `dashboard.controller` + `dashboard.module` + registro no
   `app.module.ts`.
7. Integração + CHANGELOG.
8. Frontend: `lib/dashboard.ts` (tipos + hook) + página `/app/dashboard`.
9. Frontend: nav + E2E.
10. Release — sem bump de versão nem tag (mesma decisão da parte 1/4:
    fecha quando as 4 partes da 0.7.0 estiverem prontas).

## 7. Versão

Ainda sem tag — continua parte da fase 0.7.0 em andamento (`[Não
lançado]` no CHANGELOG, sem bump de versão). Nenhuma env nova.
