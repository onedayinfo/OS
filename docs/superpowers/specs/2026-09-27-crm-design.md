# CRM — Funil de vendas e relacionamento (fase fora do roadmap, entre 0.7.0 e 0.8.0)

Data: 2026-09-27
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `c34c18e` (release 0.9.0)
Roadmap: não estava no `docs/roadmap.md` original — inserida por pedido direto do
usuário, entre a fase 0.7.0 (Gestão/SLA/CSAT) e a 0.8.0 (Financeiro).

## 1. Objetivo

Dar à equipe um funil de vendas simples: leads (ainda não são cliente) e
oportunidades sobre clientes já existentes (upsell/renovação), num board único
por estágio, com timeline de notas e follow-up agendado. Quando uma
oportunidade é ganha, vira Cliente automaticamente (se ainda não for) — sem
duplicar cadastro.

Entregas:

1. `Opportunity` — um conceito só (sem separar Lead × Oportunidade), com
   estágio, valor estimado, responsável, e referência opcional a um
   `Client` existente **ou** dados soltos de lead (nome/empresa/telefone/
   e-mail).
2. Board por estágio (`NEW → CONTACTED → PROPOSAL → WON/LOST`), sem
   drag-and-drop — avanço por botão/menu.
3. Timeline de notas (`OpportunityNote`) por oportunidade.
4. Follow-up: um campo "próxima ação" (data + nota) por oportunidade, com
   lista de follow-ups de hoje/atrasados.
5. Ao marcar `WON`: se a oportunidade não tinha `clientId`, cria um `Client`
   a partir dos dados de lead e vincula.
6. Link opcional a um `Quote` (módulo `quotes`, já existente) — não duplica
   valor/proposta quando já existe orçamento de verdade.
7. 100% interno (`ADMIN`/`AGENT`); nada aparece no portal do cliente.

Fora de escopo (adiado — questionado no brainstorm, YAGNI por ora): metas e
comissão por vendedor (isso é `docs/roadmap.md` 0.8.0, "Comissão de técnico e
vendedor"); relatórios de funil (taxa de conversão, tempo por estágio —
candidato a entrar no Dashboard existente numa fase futura, reaproveitando o
padrão de `dashboard` sem model novo); importação de leads (CSV/formulário
web); e-mail automático de lembrete de follow-up (a lista "hoje/atrasados" na
tela já resolve, sem precisar de cron+e-mail agora); estágios configuráveis
(fixo em enum, como decidido no brainstorm — configurável fica pra se um dia
o funil precisar mudar de fato); múltiplos responsáveis/compartilhamento por
oportunidade.

## 2. Decisões travadas (do brainstorm)

- **Um conceito só**: `Opportunity` cobre lead frio e oportunidade sobre
  cliente existente — mesmo padrão da unificação "Chamado" do MVP. O que
  muda é só se `clientId` está preenchido ou não.
- **Estágios fixos** (enum, não configurável): `NEW`, `CONTACTED`,
  `PROPOSAL`, `WON`, `LOST`. Sem seed/tabela de configuração — YAGNI, mesmo
  espírito de "config pra valor que não muda".
- **Board sem drag-and-drop**: evita dependência nova (dnd-kit/similar);
  avanço de estágio é um botão/`Select` na ficha e no card, igual ao padrão
  de mudança de status já usado em Chamados/Contratos.
- **Ganho (`WON`) sem `clientId`** → cria `Client` automaticamente
  (`name` = `leadCompany` ou `leadName`; `notes` recebe uma linha sintética
  com contato: nome/telefone/e-mail do lead). **Não** cria `User`/contato de
  portal automaticamente — isso continua sendo cadastro manual do
  ADMIN, como hoje.
- **Ganho com `clientId` já preenchido** → só marca `wonAt`, nada mais.
- **`quoteId` é só um link opcional**, sem side-effect: a oportunidade não
  cria orçamento nem o orçamento cria oportunidade. Serve pra não duplicar
  valor quando já existe um orçamento de verdade — a ficha mostra o valor do
  `Quote` linkado no lugar do `value` estimado, quando presente.
- **`lostReason` obrigatório** só quando `stage → LOST` (validação no
  service, não constraint de banco — mesmo padrão de outras transições
  condicionais do projeto).
- **Follow-up é um campo só** (`nextFollowUpAt` + `nextFollowUpNote`) na
  própria oportunidade, não uma lista de tarefas — sempre a *próxima* ação,
  substituída a cada atualização. Histórico de ações passadas fica na
  timeline de notas.
- **Responsável (`ownerId`)** é obrigatório, `ADMIN`/`AGENT`, reatribuível —
  mesmo padrão do técnico em chamado/visita. Sem notificação por
  reatribuição nesta fase.
- **Sem migração de dados**: funil começa vazio.

## 3. Arquitetura

### 3.1 Schema Prisma

```prisma
enum OpportunityStage {
  NEW
  CONTACTED
  PROPOSAL
  WON
  LOST
}

model Opportunity {
  id                String           @id @default(cuid())
  title             String
  stage             OpportunityStage @default(NEW)
  value             Float?
  clientId          String?
  leadName          String?
  leadCompany       String?
  leadPhone         String?
  leadEmail         String?
  ownerId           String
  quoteId           String?          @unique
  lostReason        String?
  nextFollowUpAt    DateTime?
  nextFollowUpNote  String?
  wonAt             DateTime?
  lostAt            DateTime?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  client Client?      @relation(fields: [clientId], references: [id])
  owner  User         @relation(fields: [ownerId], references: [id])
  quote  Quote?       @relation(fields: [quoteId], references: [id])
  notes  OpportunityNote[]

  @@index([clientId])
  @@index([ownerId])
  @@index([stage])
  @@map("opportunities")
}

model OpportunityNote {
  id            String   @id @default(cuid())
  opportunityId String
  authorId      String
  text          String
  createdAt     DateTime @default(now())

  opportunity Opportunity @relation(fields: [opportunityId], references: [id], onDelete: Cascade)
  author      User        @relation(fields: [authorId], references: [id])

  @@index([opportunityId])
  @@map("opportunity_notes")
}
```

Alterações em models existentes:
- `Client` ganha `opportunities Opportunity[]`.
- `User` ganha `opportunitiesOwned Opportunity[]` e `opportunityNotes
  OpportunityNote[]`.
- `Quote` ganha `opportunity Opportunity?` (lado 1:1 do `quoteId` único).

Validação de dados de lead vs. cliente (na camada de serviço, não constraint
de banco — mais simples e consistente com o resto do projeto): exatamente um
dos dois preenchido — `clientId` **ou** pelo menos `leadName`. Nunca os dois
vazios.

### 3.2 Backend — módulo `crm`

```
backend/src/
  crm/
    crm.module.ts
    opportunities.service.ts   # CRUD + mudança de estágio + notas + follow-ups
    opportunities.controller.ts
    dto/create-opportunity.dto.ts
    dto/update-opportunity.dto.ts
    dto/change-stage.dto.ts
    dto/create-note.dto.ts
    dto/list-opportunities.dto.ts
    opportunities.service.spec.ts
```

`CrmModule` importa `ClientsModule`/`PrismaModule` (mesmo padrão dos demais
módulos); não precisa de cron.

### 3.3 Rotas

Todas com `@Roles('ADMIN', 'AGENT')`.

- `GET /opportunities?stage=&ownerId=&clientId=` — lista com filtros; sempre
  inclui `client: {id,name}`, `owner: {id,name}`, `quote: {id,number,total}?`
  (total calculado como em `QuotesService.findOne`, reaproveitando a mesma
  função de soma de itens).
- `GET /opportunities/follow-ups?scope=today|overdue` — lista enxuta
  (`id`,`title`,`clientId?`,`leadName?`,`nextFollowUpAt`,`nextFollowUpNote`,
  `ownerId`) pras oportunidades abertas (`stage` não `WON`/`LOST`) com
  `nextFollowUpAt` vencido ou de hoje.
- `GET /opportunities/:id` — ficha completa + `notes` ordenadas por
  `createdAt desc`.
- `POST /opportunities` — cria. Body: `title`, `value?`, `ownerId`,
  `clientId?` OU (`leadName`,`leadCompany?`,`leadPhone?`,`leadEmail?`),
  `quoteId?`. Valida clientId⊕lead (client ou lead, nunca os dois vazios;
  se os dois vierem preenchidos, `clientId` prevalece e os campos de lead são
  ignorados — evita ambiguidade sem precisar rejeitar o payload).
- `PATCH /opportunities/:id` — edição livre de `title`/`value`/`ownerId`/
  campos de lead/`quoteId`/`nextFollowUpAt`/`nextFollowUpNote`. **Não** muda
  `stage` (rota própria abaixo).
- `PATCH /opportunities/:id/stage` — body `{ stage, lostReason? }`.
  - `stage: LOST` sem `lostReason` → `400`.
  - `stage: WON` sem `clientId` → cria `Client` (transação: `client.create`
    + `opportunity.update({clientId, wonAt: now()})`); com `clientId` já
    presente → só `wonAt: now()`.
  - Volta de `WON`/`LOST` pra estágio anterior é permitida (reabrir), mas
    **não desfaz** o `Client` criado — fica como cliente de verdade, mesmo
    padrão de "não desfazer efeito colateral" do `createFromQuote`.
- `POST /opportunities/:id/notes` — body `{ text }`, `authorId` do
  `CurrentUser`.
- `DELETE /opportunities/:id` — só se `stage` não for `WON` (evita apagar
  histórico de algo que virou cliente de verdade); `403`/`400` se for.

### 3.4 Regra de conversão em cliente (`OpportunitiesService.winWithoutClient`)

```ts
private async winWithoutClient(tx: Prisma.TransactionClient, opp: Opportunity) {
  const contactLine = [opp.leadName, opp.leadPhone, opp.leadEmail]
    .filter(Boolean)
    .join(' — ');
  const client = await tx.client.create({
    data: {
      name: opp.leadCompany ?? opp.leadName ?? opp.title,
      notes: contactLine ? `Contato original (CRM): ${contactLine}` : null,
    },
  });
  return tx.opportunity.update({
    where: { id: opp.id },
    data: { clientId: client.id, stage: 'WON', wonAt: new Date() },
  });
}
```

### 3.5 Frontend

**Navegação**: item **CRM** em `/app/crm` (`ADMIN`,`AGENT`).

**`/app/crm`** — board com 5 colunas (uma por estágio); cada card mostra
título, cliente/lead, valor (do `quote.total` se linkado, senão `value`),
responsável, badge de follow-up atrasado. Card tem menu "mover para →
{próximo estágio válido}" (sem drag-and-drop). Filtros: responsável (select,
default "meus"), toggle "mostrar ganhos/perdidos". Bloco fixo no topo:
**Follow-ups de hoje/atrasados** (lista compacta, link pra ficha).

**`/app/crm/novo`** — form: título, valor estimado, responsável, e um
toggle "Lead novo" vs "Cliente existente" (select de `Client` no segundo
caso; campos nome/empresa/telefone/e-mail no primeiro).

**`/app/crm/[id]`** — ficha: dados da oportunidade (editáveis), seletor de
próximo estágio (com campo `lostReason` condicional quando escolhe
"Perdido"), campo "próxima ação" (data + nota), link pro `Quote` (se
houver, mostra número/valor/status do orçamento), timeline de notas (lista +
textarea pra nova nota).

**`/app/clientes/[id]`** — nova aba **Oportunidades**: lista simples das
oportunidades daquele cliente (título, estágio, valor, responsável).

### 3.6 Migração

Prisma migrate: tabelas novas `opportunities`, `opportunity_notes`; enum
`OpportunityStage`. Sem backfill.

## 4. Fluxos

### 4.1 Lead novo
ADMIN/AGENT cria oportunidade com dados de lead (sem `clientId`) → registra
notas conforme conversa avança → agenda follow-up → avança estágio até
`WON` → `Client` criado automaticamente, oportunidade linkada a ele.

### 4.2 Upsell em cliente existente
Cria oportunidade já com `clientId` de um `Client` atual → opcionalmente
linka a um `Quote` já em elaboração → ganha ou perde sem criar cliente novo.

### 4.3 Perda
Estágio `LOST` exige motivo (texto livre). Oportunidade fica visível no
board (coluna Perdido, se o toggle "mostrar ganhos/perdidos" estiver ligado)
mas sai das listas de follow-up.

### 4.4 Follow-up
Bloco no topo do board lista tudo com `nextFollowUpAt <= hoje` entre as
oportunidades abertas — sem cron nem e-mail, só leitura na tela ao abrir o
CRM.

## 5. Erros e bordas

- `POST /opportunities` sem `clientId` e sem `leadName` → `400`.
- `PATCH /opportunities/:id/stage` pra `LOST` sem `lostReason` → `400`.
- `PATCH /opportunities/:id/stage` pra `WON` numa oportunidade que já tem
  `clientId` → idempotente (só marca `wonAt` se ainda não tinha).
- `DELETE` de oportunidade `WON` → `400` (preserva o rastro de como o
  cliente nasceu).
- `quoteId` de orçamento que já pertence a outra oportunidade → `400`
  (constraint `@unique` no schema + checagem amigável no service antes do
  erro de banco estourar).
- Reabrir (`WON`/`LOST` → estágio anterior) não remove `Client` já criado
  nem desvincula `quoteId`.

## 6. Testes

Unit (Vitest):
- `opportunities.service` — CRUD; validação `clientId` ⊕ lead; `PATCH
  .../stage` pra `LOST` exige `lostReason`; pra `WON` sem `clientId` cria
  `Client` (mock de transação) e vincula; pra `WON` com `clientId` não cria
  nada novo; `DELETE` bloqueado em `WON`; `quoteId` duplicado rejeitado;
  `follow-ups` filtra por `nextFollowUpAt` e exclui `WON`/`LOST`.

Integração (exige Postgres):
- Ciclo completo: criar oportunidade de lead → adicionar nota → agendar
  follow-up → marcar `WON` → `Client` real criado no banco, `clientId`
  gravado, oportunidade some da lista de follow-ups.
- Oportunidade sobre cliente existente linkada a um `Quote` real → `GET
  /opportunities/:id` retorna o total do orçamento.

E2E Playwright (fumaça): criar oportunidade de lead pelo board → abrir ficha
→ adicionar nota → mover pra "Ganho" → conferir que o cliente aparece em
`/app/clientes`.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma + migração (`Opportunity`, `OpportunityNote`, enum,
   relações em `Client`/`User`/`Quote`).
2. `opportunities.service` — CRUD + validação `clientId`⊕lead + testes.
3. `opportunities.service` — `PATCH .../stage` (incl. criação de `Client` no
   `WON`, exigência de `lostReason` no `LOST`) + testes.
4. `opportunities.service` — notas + follow-ups (`today`/`overdue`) + testes.
5. `opportunities.controller` + `crm.module` + registro no `app.module.ts`.
6. Integração + CHANGELOG.
7. Frontend: `lib/crm.ts` (tipos + hooks).
8. Frontend: `/app/crm` (board) + `/app/crm/novo` + `/app/crm/[id]` (ficha
   com timeline/notas/follow-up).
9. Frontend: aba Oportunidades no cliente.
10. E2E + release.

## 8. Versão

MINOR (funcionalidade nova, retrocompatível). Nenhuma env nova. Como não
estava no `docs/roadmap.md`, inserir a fase ali (entre 0.7.0 e 0.8.0) e
atualizar `CHANGELOG.md` em "Não lançado" durante o desenvolvimento.
