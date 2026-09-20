# Catálogo, Orçamento e Estoque (Fase 0.6.0)

Data: 2026-09-20
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `581020c` (release 0.5.0)
Roadmap: `docs/roadmap.md` — 0.6.0 "Catálogo, orçamento e estoque"

## 1. Objetivo

Cobrir o trabalho **fora de contrato** (instalação, expansão, troca de
equipamento) e dar custo real ao chamado: um catálogo de serviços/produtos,
controle de estoque por depósito (incluindo a van do técnico) e orçamentos
que o cliente aprova por link público, virando chamado.

Entregas:

1. **Catálogo** único de itens — serviço (mão de obra) ou produto (material),
   com preço e unidade.
2. **Estoque** por depósito: saldo, entrada (compra, com custo unitário e
   custo médio), transferência atômica entre depósitos, requisição de
   material amarrada ao chamado (baixa direta, sem aprovação), alerta visual
   de estoque mínimo.
3. **Orçamento**: itens do catálogo (serviço + material), pode nascer de um
   chamado existente ou avulso, versionado (revisão = novo registro ligado à
   proposta original), aprovação/rejeição do cliente por link público sem
   login. Aprovado (e avulso) vira chamado automaticamente.

Fora de escopo (adiado): reserva de estoque na aprovação do orçamento (a
baixa continua acontecendo só na requisição de material, igual sem
orçamento); aprovação de excedente de franquia por orçamento (depende desta
fase existir, mas o encadeamento fica pra depois); faturamento do orçamento
aprovado (fase 0.8.0); margem por chamado / dashboards de custo (fase 0.7.0
— esta fase só grava o dado de custo, `unitCost`/`avgCost`, que a 0.7.0 vai
consumir); alerta por e-mail de estoque mínimo (só sinalização visual agora);
transição automática de `Quote`/contrato por vencimento de validade.

## 2. Decisões travadas (do brainstorm)

- **Orçamento nasce de chamado OU avulso.** Avulso exige `Client` já
  cadastrado (sem modelo de "lead"); se o cliente é novo, cadastra primeiro
  na tela que já existe.
- **Catálogo é um modelo só** (`CatalogItem`) com `type: SERVICE | PRODUCT`,
  não dois modelos separados — um cadastro, um picker no orçamento.
- **Só item `PRODUCT` participa de estoque.** `StockBalance` é criado de
  forma preguiçosa (lazy) na primeira movimentação de um item num depósito.
- **Múltiplos depósitos com transferência explícita** — mover estoque entre
  depósitos (ex.: almoxarifado → van do técnico) é uma operação atômica
  (decrementa origem, incrementa destino), não dois lançamentos manuais
  desencontrados.
- **Requisição de material no chamado**: o técnico escolhe o depósito de
  origem na hora (sem depósito fixo por técnico) e a baixa é **direta, sem
  aprovação** — sem fluxo de "requisição pendente".
- **Estoque mínimo só sinaliza na tela** (destaque visual quando
  `quantity < minQuantity`) — sem cron, sem e-mail nesta fase.
- **Entrada de estoque registra custo unitário**, e o item acumula
  `avgCost` (custo médio ponderado) por depósito — usado pela 0.7.0 pra
  calcular margem; nenhuma migração retroativa necessária porque o dado já
  nasce certo.
- **Orçamento aprovado NÃO baixa estoque sozinho.** A baixa real continua
  acontecendo na requisição de material durante a execução, exatamente como
  seria sem orçamento nenhum — evita o conceito novo de "reserva".
- **"Orçamento versionado" = nova revisão é um novo registro** (`version`
  incrementado, mesmo `rootQuoteId`), não edição in-place. Revisar só é
  permitido a partir de `SENT`/`REJECTED`; a versão anterior vira
  `SUPERSEDED`. `DRAFT` continua editável in-place.
- **Aprovação/rejeição por link público** (`publicToken`, sem login),
  seguindo o mesmo padrão de token plano único já usado em
  `User.inviteToken`. Ação idempotente: token já usado responde 409 com o
  status atual, sem duplicar efeito.
- **Preço e custo são sempre snapshot.** `QuoteItem.unitPrice` e
  `TicketMaterialUsage.unitCost` congelam o valor no momento do lançamento;
  mudar o preço do catálogo depois não altera orçamentos/requisições já
  gravados.

## 3. Arquitetura

### 3.1 Schema Prisma

```prisma
enum CatalogItemType {
  SERVICE
  PRODUCT
}

model CatalogItem {
  id       String          @id @default(cuid())
  name     String
  type     CatalogItemType
  unit     String
  price    Float
  active   Boolean         @default(true)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  balances             StockBalance[]
  stockEntries         StockEntry[]
  stockTransfers       StockTransfer[]
  materialUsages       TicketMaterialUsage[]
  quoteItems           QuoteItem[]

  @@map("catalog_items")
}

model Warehouse {
  id       String   @id @default(cuid())
  name     String
  active   Boolean  @default(true)
  createdAt DateTime @default(now())

  balances          StockBalance[]
  entries           StockEntry[]
  transfersOut      StockTransfer[] @relation("TransferFrom")
  transfersIn       StockTransfer[] @relation("TransferTo")
  materialUsages    TicketMaterialUsage[]

  @@map("warehouses")
}

model StockBalance {
  catalogItemId String
  warehouseId   String
  quantity      Float    @default(0)
  minQuantity   Float?
  avgCost       Float    @default(0)
  updatedAt     DateTime @updatedAt

  catalogItem CatalogItem @relation(fields: [catalogItemId], references: [id])
  warehouse   Warehouse   @relation(fields: [warehouseId], references: [id])

  @@id([catalogItemId, warehouseId])
  @@map("stock_balances")
}

model StockEntry {
  id            String   @id @default(cuid())
  catalogItemId String
  warehouseId   String
  quantity      Float
  unitCost      Float
  notes         String?
  createdById   String
  createdAt     DateTime @default(now())

  catalogItem CatalogItem @relation(fields: [catalogItemId], references: [id])
  warehouse   Warehouse   @relation(fields: [warehouseId], references: [id])

  @@map("stock_entries")
}

model StockTransfer {
  id              String   @id @default(cuid())
  catalogItemId   String
  fromWarehouseId String
  toWarehouseId   String
  quantity        Float
  notes           String?
  createdById     String
  createdAt       DateTime @default(now())

  catalogItem   CatalogItem @relation(fields: [catalogItemId], references: [id])
  fromWarehouse Warehouse   @relation("TransferFrom", fields: [fromWarehouseId], references: [id])
  toWarehouse   Warehouse   @relation("TransferTo", fields: [toWarehouseId], references: [id])

  @@map("stock_transfers")
}

model TicketMaterialUsage {
  id            String   @id @default(cuid())
  ticketId      String
  catalogItemId String
  warehouseId   String
  quantity      Float
  unitCost      Float
  createdById   String
  createdAt     DateTime @default(now())

  ticket      Ticket      @relation(fields: [ticketId], references: [id])
  catalogItem CatalogItem @relation(fields: [catalogItemId], references: [id])
  warehouse   Warehouse   @relation(fields: [warehouseId], references: [id])

  @@index([ticketId])
  @@map("ticket_material_usages")
}

enum QuoteStatus {
  DRAFT
  SENT
  APPROVED
  REJECTED
  SUPERSEDED
}

model Quote {
  id           String      @id @default(cuid())
  number       Int
  clientId     String
  ticketId     String?
  categoryId   String?
  title        String?
  status       QuoteStatus @default(DRAFT)
  version      Int         @default(1)
  rootQuoteId  String?
  publicToken  String      @unique
  validUntil   DateTime?
  notes        String?
  sentAt       DateTime?
  approvedAt   DateTime?
  rejectedAt   DateTime?
  createdById  String
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  client   Client    @relation(fields: [clientId], references: [id])
  ticket   Ticket?   @relation(fields: [ticketId], references: [id])
  category Category? @relation(fields: [categoryId], references: [id])
  items    QuoteItem[]

  @@index([clientId])
  @@index([ticketId])
  @@map("quotes")
}

model QuoteItem {
  id            String  @id @default(cuid())
  quoteId       String
  catalogItemId String
  description   String?
  quantity      Float
  unitPrice     Float

  quote       Quote       @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  catalogItem CatalogItem @relation(fields: [catalogItemId], references: [id])

  @@map("quote_items")
}
```

Alterações em models existentes:
- `Ticket` ganha `originQuoteId String?` (FK, índice), relação `originQuote`
  e a relação reversa `quotes Quote[]` (um chamado pode ter vários
  orçamentos ao longo do tempo, ex.: expansão pedida depois).
- `Client` ganha `quotes Quote[]`.
- `Category` ganha `quotes Quote[]` (usada só quando `ticketId` é nulo).
- `TicketOrigin` ganha o valor `QUOTE` (chamado gerado pela aprovação de um
  orçamento avulso).

### 3.2 Backend — módulos novos

```
backend/src/
  catalog/
    catalog.module.ts
    catalog.service.ts        # CRUD de CatalogItem
    catalog.controller.ts
    dto/{create,update}-catalog-item.dto.ts
    catalog.service.spec.ts
  stock/
    stock.module.ts
    stock.service.ts          # warehouses, saldo, entrada, transferência, requisição
    stock.controller.ts
    dto/{create-warehouse,stock-entry,stock-transfer,material-usage}.dto.ts
    stock.service.spec.ts
  quotes/
    quotes.module.ts
    quotes.service.ts         # CRUD, revisão, aprovação/rejeição pública
    quotes.controller.ts      # rotas autenticadas (ADMIN/AGENT)
    quotes-public.controller.ts  # rotas @Public por token
    dto/{create-quote,quote-item}.dto.ts
    quote-number.service.ts   # mesmo padrão transacional do TicketNumberService
    quotes.service.spec.ts
```

`StockModule` importa `CatalogModule` (valida `type: PRODUCT`).
`QuotesModule` importa `CatalogModule` (preço no momento do item) e
`TicketsModule` (cria chamado na aprovação avulsa).

### 3.3 Rotas

**catalog**
- `GET /catalog-items?type=&active=` — `ADMIN`,`AGENT`.
- `POST /catalog-items` / `PATCH /catalog-items/:id` — `ADMIN`. `PATCH` com
  `active: false` não afeta registros históricos (orçamentos/estoque já
  gravados mantêm o snapshot).

**stock**
- `GET /warehouses` — `ADMIN`,`AGENT`. `POST /warehouses` — `ADMIN`.
- `PATCH /warehouses/:id` (`active: false`) — `ADMIN`; `400` se algum
  `StockBalance` do depósito tem `quantity > 0`.
- `GET /stock/balances?warehouseId=&catalogItemId=&belowMinimum=` —
  `ADMIN`,`AGENT`. Cada linha traz `belowMinimum: quantity < minQuantity`
  (quando `minQuantity` setado).
- `PATCH /stock/balances/:catalogItemId/:warehouseId` (só `minQuantity`) —
  `ADMIN`.
- `POST /stock/entries` — `ADMIN`,`AGENT`. Cria `StockEntry`, soma
  `quantity` e recalcula `avgCost` do `StockBalance` (cria a linha se não
  existir). `400` se `catalogItem.type !== 'PRODUCT'`.
- `POST /stock/transfers` — `ADMIN`,`AGENT`. Transação: decrementa origem
  (`400` se saldo insuficiente ou `fromWarehouseId === toWarehouseId`),
  incrementa destino com o mesmo `avgCost`.
- `POST /tickets/:id/material-usages` — `ADMIN`,`AGENT`. Cria
  `TicketMaterialUsage`, decrementa `StockBalance` do depósito escolhido
  (`400` se saldo insuficiente); `400` se o chamado está `CLOSED`.
- `GET /tickets/:id/material-usages` — junto do detalhe do chamado.

**quotes**
- `GET /quotes?clientId=&ticketId=&status=` — `ADMIN`,`AGENT`.
- `GET /quotes/:id` — inclui `items` (com `catalogItem` resumido) e
  `total` calculado (`sum(quantity*unitPrice)`).
- `POST /quotes` — `ADMIN`,`AGENT`. `ticketId` opcional; se ausente, exige
  `categoryId` e `title`. `status` inicial `DRAFT`, `publicToken` gerado
  (`randomBytes(24).toString('hex')`), `number` sequencial **por ano civil**
  (mesmo padrão do `TicketNumberService`: contador transacional, sem reset
  por cliente). Uma revisão (`/revise`) **não** consome novo número — herda
  o `number` da raiz, só o `version` incrementa.
- `PATCH /quotes/:id` — só se `status === 'DRAFT'`; `400` fora disso
  (orienta a usar `POST /quotes/:id/revise`).
- `POST /quotes/:id/send` — `DRAFT → SENT`, grava `sentAt`.
- `POST /quotes/:id/revise` — só a partir de `SENT`/`REJECTED`: cria novo
  `Quote` (`version+1`, mesmo `rootQuoteId`, itens copiados, novo
  `publicToken`, `status: DRAFT`), marca o atual `SUPERSEDED`.
- `DELETE /quotes/:id` — só `DRAFT`.

**quotes-public** (`@Public`, sem guard de auth)
- `GET /public/quotes/:token` — devolve dados de exibição (cliente, itens,
  total, status, `validUntil`); `404` se token não existe; inclui
  `superseded: true`/link pra versão atual quando aplicável.
- `POST /public/quotes/:token/approve` — só se `status === 'SENT'`; fora
  disso `409` com o `status` atual. Efeitos: ver §3.4.
- `POST /public/quotes/:token/reject` — só se `status === 'SENT'`; grava
  `rejectedAt`, `status: REJECTED`.

### 3.4 Aprovação do orçamento (`QuotesService.approve`)

```ts
async approve(token: string) {
  const quote = await this.prisma.quote.findUnique({ where: { publicToken: token }, include: { items: true } });
  if (!quote) throw new NotFoundException();
  if (quote.status !== 'SENT') {
    throw new ConflictException({ status: quote.status }); // idempotente
  }
  return this.prisma.$transaction(async (tx) => {
    let ticketId = quote.ticketId;
    if (!ticketId) {
      const ticket = await this.ticketsService.createFromQuote(tx, {
        clientId: quote.clientId,
        categoryId: quote.categoryId!,
        title: quote.title!,
        origin: 'QUOTE',
      });
      ticketId = ticket.id;
    }
    return tx.quote.update({
      where: { id: quote.id },
      data: { status: 'APPROVED', approvedAt: new Date(), ticketId },
    });
  });
}
```

`TicketsService.createFromQuote` é um método fino que monta os mesmos
campos default do `create()` humano (prioridade `MEDIUM`, `needsTriage:
false` — orçamento já qualificou o pedido) mas sem exigir `actor`, análogo ao
que o `ContractPreventiveCron` já faz direto via Prisma na 0.5.0. Sem
agendamento de visita automático — segue o fluxo normal da Agenda.

### 3.5 Cálculo de custo médio (`StockService`)

Entrada:
```
novoAvgCost = saldoAtual === 0
  ? custoDaEntrada
  : (saldoAtual * avgCostAtual + quantidadeEntrada * custoDaEntrada) / (saldoAtual + quantidadeEntrada)
```

Transferência: destino herda o `avgCost` de origem tal como está (mesmo
lote fisicamente movido, sem precisar de nova média — se o destino já tinha
saldo de outra origem, aí sim pondera pela mesma fórmula da entrada, usando
`avgCost` de origem como "custo da entrada").

Requisição de material: só lê `avgCost` atual do depósito pra gravar o
snapshot em `TicketMaterialUsage.unitCost`; não recalcula nada.

### 3.6 Frontend

**Navegação**: itens **Catálogo**, **Estoque** e **Orçamentos** em
`/app/catalogo`, `/app/estoque`, `/app/orcamentos` (`ADMIN`,`AGENT` na nav;
escrita restrita a `ADMIN` só onde o backend já restringe — estoque e
orçamento ficam abertos a `AGENT` para uso operacional em campo).

**`/app/catalogo`** — lista com filtro por tipo; form de criar/editar
(nome, tipo, unidade, preço, ativo).

**`/app/estoque`** — abas: **Saldos** (tabela item×depósito, linha em
destaque quando `belowMinimum`, campo de `minQuantity` editável inline),
**Entradas** (form: depósito, item `PRODUCT`, quantidade, custo unitário),
**Transferências** (form: item, origem, destino, quantidade),
**Depósitos** (CRUD simples de `Warehouse`).

**`/app/orcamentos`** — lista (cliente, número, status badge, total,
versão); **novo** (cliente ou chamado de origem, categoria+título se
avulso, itens do catálogo com quantidade/preço editável, botão Enviar);
**ficha** — itens, total, status, botão Revisar (se `SENT`/`REJECTED`),
link público copiável.

**Página pública** `/orcamento/[token]` (fora do `/app`, sem guard de
sessão): mostra itens/total, botões Aprovar/Rejeitar; após ação, mensagem
de confirmação (sem redirecionar pra dentro do sistema).

**Chamado (`/app/chamados/[id]`)**: nova seção "Materiais usados" (lista de
`TicketMaterialUsage` + form pra registrar novo, com picker de item
`PRODUCT` e depósito) e "Orçamentos" (lista dos `Quote` ligados a esse
chamado, se houver).

### 3.7 Migração

Prisma migrate: tabelas novas `catalog_items`, `warehouses`,
`stock_balances`, `stock_entries`, `stock_transfers`,
`ticket_material_usages`, `quotes`, `quote_items`; enums `CatalogItemType`,
`QuoteStatus`; `tickets.originQuoteId` (nullable, índice); `TicketOrigin` +=
`QUOTE`. Sem backfill.

## 4. Fluxos

### 4.1 Cadastro de catálogo e depósitos
ADMIN cadastra itens (serviço/produto) e depósitos (almoxarifado, van de
cada técnico) antes de usar orçamento/estoque.

### 4.2 Compra e transferência
Entrada de material registra custo e atualiza saldo/custo médio do
depósito. Transferência move saldo (com custo) pra outro depósito, ex. pra
abastecer a van antes de uma visita.

### 4.3 Orçamento a partir de um chamado
Chamado aberto → ADMIN/AGENT monta orçamento com os itens necessários →
envia → cliente aprova pelo link → `Quote.status: APPROVED`, chamado
permanece o mesmo (`ticketId` já existia).

### 4.4 Orçamento avulso (venda nova)
Cliente já cadastrado, sem chamado ainda → orçamento avulso (categoria +
título) → enviado → aprovado → cria o chamado automaticamente
(`origin: QUOTE`) → segue o fluxo normal de agendamento na Agenda.

### 4.5 Execução com baixa de material
Durante a visita, técnico registra o material usado no chamado (item +
depósito + quantidade) → baixa imediata do saldo, snapshot do custo.

### 4.6 Estoque mínimo
Tela de Saldos sinaliza visualmente quando algum item está abaixo do
`minQuantity` configurado — sem notificação automática.

## 5. Erros e bordas

- `POST /stock/entries` ou `/material-usages` com `catalogItem.type !==
  'PRODUCT'` → `400`.
- Saldo insuficiente em transferência ou requisição → `400`, nada é gravado.
- `fromWarehouseId === toWarehouseId` na transferência → `400`.
- Desativar `Warehouse` com algum `StockBalance.quantity > 0` → `400`.
- `PATCH /quotes/:id` fora de `DRAFT` → `400` (orienta usar `/revise`).
- `POST /quotes/:id/revise` fora de `SENT`/`REJECTED` → `400`.
- `POST /quotes` sem `ticketId` e sem `categoryId`/`title` → `400`.
- Aprovar/rejeitar token já resolvido (`APPROVED`/`REJECTED`/`SUPERSEDED`)
  → `409`, resposta idempotente com o status atual (dupla submissão do
  link público não duplica efeito).
- `GET /public/quotes/:token` com token inexistente → `404`, sem vazar se é
  formato inválido ou já usado.
- Registrar material usado em chamado `CLOSED` → `400`.
- `CatalogItem` desativado continua válido em orçamentos/estoque já
  existentes; some só do picker de novos lançamentos.

## 6. Testes

Unit (Vitest):
- `catalog.service` — CRUD, `active: false` não quebra referências
  existentes.
- `stock.service` — entrada (saldo do zero e com saldo prévio, cálculo de
  `avgCost`), transferência (saldo suficiente/insuficiente, mesmo
  depósito → erro, herança de `avgCost`), requisição de material (baixa,
  saldo insuficiente, chamado fechado → erro), `belowMinimum` calculado
  certo.
- `quotes.service` — criação (com/sem `ticketId`, validação de
  categoria+título quando avulso), numeração sequencial, `PATCH` bloqueado
  fora de `DRAFT`, `revise` (só a partir de `SENT`/`REJECTED`, copia itens,
  supersede a versão antiga), `approve` (cria chamado quando avulso, não
  cria quando já tem `ticketId`, idempotência em token já resolvido),
  `reject`.

Integração (exige Postgres):
- Ciclo completo de estoque: entrada → transferência → requisição no
  chamado → saldo final correto nos dois depósitos.
- Ciclo completo de orçamento avulso: criar → enviar → aprovar por token →
  chamado criado com `origin: QUOTE` e `originQuoteId` certo.

E2E Playwright (fumaça): criar orçamento avulso → copiar link público →
aprovar sem login → chamado aparece na fila.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma + migração (todos os models/enums novos desta fase).
2. `catalog.service` + controller + module + testes.
3. `stock.service` — saldo/entrada + testes.
4. `stock.service` — transferência + testes.
5. `stock.service` — requisição de material (`TicketMaterialUsage`) + rota
   em `tickets` + testes.
6. `stock.controller`/`stock.module` (warehouses, balances, entries,
   transfers) + registro no `app.module.ts`.
7. `quote-number.service` (padrão do `TicketNumberService`) + testes.
8. `quotes.service` — CRUD + validação avulso/ticket + testes.
9. `quotes.service` — `revise` + testes.
10. `TicketsService.createFromQuote` (método fino, sem actor) + testes.
11. `quotes.service` — `approve`/`reject` + `quotes-public.controller` +
    testes.
12. `quotes.controller`/`quotes.module` + registro no `app.module.ts`.
13. Integração + CHANGELOG.
14. Frontend: `lib/catalog.ts`, `lib/stock.ts`, `lib/quotes.ts` (tipos +
    hooks).
15. Frontend: `/app/catalogo`.
16. Frontend: `/app/estoque` (saldos, entradas, transferências, depósitos).
17. Frontend: `/app/orcamentos` (lista, novo, ficha) + página pública
    `/orcamento/[token]`.
18. Frontend: seções "Materiais usados"/"Orçamentos" no chamado.
19. E2E + release 0.6.0.

## 8. Versão

MINOR → **0.6.0** (funcionalidade nova, retrocompatível). Nenhuma env nova.
`CHANGELOG.md` em "Não lançado" durante o desenvolvimento.
