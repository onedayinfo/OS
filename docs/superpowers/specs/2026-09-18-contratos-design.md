# Contratos de Manutenção Recorrente (Fase 0.5.0)

Data: 2026-09-18
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `147860f` (release 0.4.0)
Roadmap: `docs/roadmap.md` — 0.5.0 "Contratos de manutenção recorrente"

## 1. Objetivo

Dar ao cliente um **contrato de manutenção**: vigência, valor mensal, escopo
de Locais/Ativos cobertos, franquia mensal (visitas ou horas) e SLA próprio
opcional. Chamados dentro do escopo do contrato se vinculam sozinhos a ele.
Chamados preventivos nascem automaticamente no calendário do contrato.

Entregas:

1. **Contrato** por cliente — vigência, valor, escopo (Locais e/ou Ativos),
   franquia (visitas **ou** horas/mês), SLA próprio opcional por prioridade.
2. **Vínculo automático** chamado ↔ contrato pelo Local/Ativo escolhido.
3. **Geração automática de chamados preventivos** (cron), um por Local do
   escopo, na frequência do contrato.
4. **Consumo de franquia** do mês corrente, com sinalização de excedente.
5. **Aviso automático** (e-mail interno) quando o contrato está a ≤30 dias do
   fim da vigência.
6. Renovação/reajuste é edição manual da ficha do contrato (`endDate`,
   `monthlyValue`) — sem fluxo dedicado nesta fase.

Fora de escopo (adiado): faturamento/cobrança do contrato (fase 0.8.0);
aprovação de excedente por orçamento (depende do catálogo, fase 0.6.0);
múltiplos contratos simultâneos cobrindo o mesmo Local/Ativo (o mais recente
vence — ver §5); renovação automática ou reajuste por índice.

## 2. Decisões travadas (do brainstorm)

- **Escopo do contrato** é uma lista explícita de **Locais e/ou Ativos**
  (N:N), não "cliente inteiro" — cliente pode ter parte do parque em
  contrato e o resto avulso.
- **Franquia** tem uma unidade por contrato: `VISITS` (nº de chamados no mês)
  ou `HOURS` (soma de horas trabalhadas das visitas no mês). Sem mistura no
  mesmo contrato.
- **Todo chamado do contrato consome franquia** — preventivo ou corretivo,
  sem distinção. Sem contador persistido: o consumo é **calculado sob
  demanda** a partir dos chamados/visitas do mês civil corrente (evita
  inconsistência entre contador e dado real).
- **Reset da franquia**: mês civil (dia 1), não aniversário do contrato.
- **Vínculo chamado ↔ contrato é automático**, nunca escolhido manualmente:
  resolvido pelo Local/Ativo do chamado no momento em que são definidos
  (criação ou `PATCH /tickets/:id/assets`, os mesmos pontos que já validam
  local⊂cliente/ativo⊂local desde a 0.3.0).
- **Geração automática de preventiva**: contrato com `preventiveFrequencyMonths`
  definido gera, via cron, **um chamado por Local do escopo** (não um chamado
  único cobrindo todo o contrato) — cada Local recebe sua própria visita.
  Chamado nasce só (sem Visita agendada); o dispatcher agenda na Agenda como
  qualquer outro. `needsTriage: false` (o cliente já é conhecido pelo
  contrato).
- **SLA do contrato** é uma tabela por prioridade (`ContractSlaPolicy`),
  espelhando o `SlaPolicy` global — só as prioridades que o contrato quer
  sobrescrever precisam de linha; as demais caem no SLA global.
- **Aviso de vencimento**: cron diário, 30 dias antes do fim da vigência,
  e-mail pros `ADMIN`, uma vez por contrato (`renewalWarnedAt`).
- **Sem migração de dados.** Contratos começam vazios; nenhum chamado
  existente ganha `contractId` retroativamente.

## 3. Arquitetura

### 3.1 Schema Prisma

```prisma
enum ContractStatus {
  ACTIVE
  EXPIRED
  CANCELLED
}

enum FranchiseUnit {
  VISITS
  HOURS
}

model Contract {
  id                        String         @id @default(cuid())
  clientId                  String
  name                      String
  status                    ContractStatus @default(ACTIVE)
  startDate                 DateTime
  endDate                   DateTime
  monthlyValue              Float?
  franchiseUnit             FranchiseUnit
  franchiseAmount           Int
  preventiveFrequencyMonths Int?
  nextGenerationAt          DateTime?
  defaultCategoryId         String?
  renewalWarnedAt           DateTime?
  notes                     String?
  createdAt                 DateTime       @default(now())
  updatedAt                 DateTime       @updatedAt

  client          Client              @relation(fields: [clientId], references: [id])
  defaultCategory Category?           @relation(fields: [defaultCategoryId], references: [id])
  locations       Location[]
  assets          Asset[]
  slaOverrides    ContractSlaPolicy[]
  tickets         Ticket[]

  @@index([clientId])
  @@map("contracts")
}

model ContractSlaPolicy {
  contractId String
  priority   TicketPriority
  hours      Int

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@id([contractId, priority])
  @@map("contract_sla_policies")
}
```

Alterações em models existentes:
- `Ticket` ganha `contractId String?` (FK, índice) + relação `contract`.
- `Client` ganha `contracts Contract[]`.
- `Location` ganha `contracts Contract[]` (lado N:N).
- `Asset` ganha `contracts Contract[]` (lado N:N).
- `Category` ganha `contracts Contract[]` (lado da relação `defaultCategory`).
- `TicketOrigin` ganha o valor `CONTRACT` (chamado gerado pelo cron
  preventivo).

### 3.2 Backend — módulo `contracts`

```
backend/src/
  contracts/
    contracts.module.ts
    contracts.service.ts       # CRUD + resolveForTicket + consumption
    contracts.controller.ts
    dto/{create,update}-contract.dto.ts
    dto/contract-sla-item.dto.ts
    contracts.service.spec.ts
  tasks/
    contract-preventive.cron.ts   # gera chamados preventivos
    contract-expiry.cron.ts       # avisa vencimento próximo
```

`ContractsModule` exporta `ContractsService`; `TasksModule` importa
`ContractsModule` pros crons.

### 3.3 Rotas

**contracts**
- `GET /contracts?clientId=&status=` — `ADMIN`,`AGENT`.
- `GET /contracts/:id` — inclui `locations`, `assets`, `slaOverrides`,
  `consumption: { unit, used, franchiseAmount, exceeded: boolean }` do mês
  civil corrente.
- `POST /contracts` — `ADMIN`. Valida `endDate > startDate`, Locais/Ativos
  pertencem ao `clientId`, `franchiseAmount > 0`.
- `PATCH /contracts/:id` — `ADMIN`. Parcial; troca de escopo (`locationIds`/
  `assetIds`) substitui a lista (`set`, igual ao `PATCH /tickets/:id/assets`).
  `slaOverrides` substitui a tabela inteira (upsert simplificado: apaga tudo
  e recria as linhas enviadas — sem histórico de SLA por contrato).
- `POST /contracts/:id/cancel` — `ADMIN`. `status → CANCELLED`; não apaga
  vínculo de chamados já criados.

**tickets** (módulo existente, alterado)
- `TicketsService.create` / `setTicketAssets`: depois de validar Local/Ativos
  (`validateLocationAndAssets`), chama `contracts.resolveForTicket(clientId,
  locationId, assetIds)` e grava `contractId` no `data` do create/update.
  Sem evento de timeline novo — `contractId` é derivado, não editável
  diretamente.
- `TicketsService.findOne`: inclui `contract: { select: { id, name } }`.
- `SlaService.dueAt(priority, from, contractId?)`: se `contractId` presente,
  busca `ContractSlaPolicy` primeiro; sem override, cai no `SlaPolicy`
  global (comportamento idêntico ao atual quando `contractId` é `undefined`).

### 3.4 Resolução de contrato (`ContractsService.resolveForTicket`)

```ts
async resolveForTicket(
  clientId: string | null,
  locationId: string | null,
  assetIds: string[],
): Promise<string | null> {
  if (!clientId || (!locationId && assetIds.length === 0)) return null;
  const contract = await this.prisma.contract.findFirst({
    where: {
      clientId,
      status: 'ACTIVE',
      OR: [
        ...(locationId ? [{ locations: { some: { id: locationId } } }] : []),
        ...(assetIds.length ? [{ assets: { some: { id: { in: assetIds } } } }] : []),
      ],
    },
    orderBy: { startDate: 'desc' },
  });
  return contract?.id ?? null;
}
```

Empate (dois contratos ativos cobrindo o mesmo Local/Ativo) resolve pelo
`startDate` mais recente — caso raro, documentado como limitação conhecida.

### 3.5 Geração automática de preventiva (`ContractPreventiveCron`)

Cron diário (`@Cron('0 6 * * *')`, mesmo estilo do `SlaBreachCron`):

1. Busca contratos `ACTIVE` com `preventiveFrequencyMonths` não nulo e
   `nextGenerationAt <= hoje`.
2. Pra cada contrato, resolve o conjunto de Locais do escopo: os
   `contract.locations` diretos **união** os locais dos `contract.assets`
   (`asset.locationId`).
3. Pra cada Local desse conjunto, cria um `Ticket` **direto via `prisma` +
   `TicketNumberService.next(tx)`** (não via `TicketsService.create`, que
   assume um `actor` humano e resolve `origin`/`clientId`/`requesterId` a
   partir dele — o cron não tem ator):
   - `origin: 'CONTRACT'`, `clientId: contract.clientId`, `requesterId: null`,
     `needsTriage: false`, `categoryId: contract.defaultCategoryId ?? null`,
     `priority: 'MEDIUM'`, `locationId`, `contractId: contract.id`.
   - `assetIds` = ativos do contrato que pertencem a esse Local (vazio se
     nenhum ativo específico do contrato estiver nesse Local).
   - `title`: `"Manutenção preventiva — {contract.name}"`; `description`
     padrão explicando a origem.
   - Evento `CREATED` na timeline, como qualquer chamado novo.
4. Atualiza `nextGenerationAt` do contrato pra
   `addMonths(nextGenerationAt ?? startDate, preventiveFrequencyMonths)`.
5. Falha em um contrato não interrompe os demais (log + segue).

### 3.6 Aviso de vencimento (`ContractExpiryCron`)

Cron diário (`@Cron('0 8 * * *')`):

1. Busca contratos `ACTIVE` com `endDate` entre hoje e hoje+30 dias e
   `renewalWarnedAt: null`.
2. Pra cada um, busca `ADMIN`s ativos e envia e-mail (`EmailService.send`,
   template novo `contractExpiring` em `email/templates.ts`, mesmo padrão
   visual dos demais).
3. Marca `renewalWarnedAt = now()` — mesmo se o e-mail falhar, loga e segue
   (evita fila presa; reenvio manual não existe nesta fase, editar a ficha e
   depois disparar de novo não é possível — aceito como limitação simples).

### 3.7 Frontend

**Navegação**: item **Contratos** em `/app/contratos` (`ADMIN`,`AGENT` via
nav, mas escrita só `ADMIN` no backend).

**`/app/contratos`** — lista: cliente, nome, vigência, status (badge),
franquia (`used/amount unit`, badge âmbar se excedente). Filtro por cliente e
status. Botão **Novo contrato**.

**`/app/contratos/novo`** e **`/app/contratos/[id]`** — form/ficha:
- Cliente (só na criação), nome, vigência (`startDate`/`endDate`), valor
  mensal, franquia (unidade + quantidade), frequência de preventiva (select:
  "Sem geração automática" / mensal / bimestral / trimestral), categoria
  padrão (select de `Category`).
- **Escopo**: multiselect de Locais do cliente + multiselect de Ativos
  (filtrado pelos Locais escolhidos, mesmo padrão do form de chamado).
- **SLA do contrato**: tabela de 4 linhas (uma por prioridade) com campo de
  horas opcional — vazio = usa o global.
- **Consumo do mês**: card read-only com `used/amount` + badge de excedente.
- Botão **Cancelar contrato** (`status → CANCELLED`), com confirmação.

**`/app/clientes/[id]`** — nova aba **Contratos**: lista simples dos
contratos do cliente (nome, vigência, status) linkando pra ficha, + botão
"Novo contrato" com cliente pré-selecionado.

**Chamado (`/app/chamados/[id]`)**: se `ticket.contract` presente, mostra um
badge/link "Contrato: {nome}" ao lado do Local/Ativos — só leitura (o vínculo
é automático).

### 3.8 Migração

Prisma migrate: tabelas novas `contracts`, `contract_sla_policies`, joins
implícitos `_ContractLocations`/`_ContractAssets`; enums `ContractStatus`,
`FranchiseUnit`; `tickets.contractId` (nullable, índice); `TicketOrigin` +=
`CONTRACT`. Sem backfill.

## 4. Fluxos

### 4.1 Cadastro
ADMIN cria contrato na ficha do cliente (ou em `/app/contratos/novo`) →
escolhe vigência, franquia, escopo (Locais/Ativos), opcionalmente SLA
próprio e frequência de preventiva.

### 4.2 Chamado dentro do escopo
Chamado aberto/triado com Local ou Ativo que está no escopo de um contrato
`ACTIVE` do cliente → `contractId` preenchido sozinho; SLA e franquia do mês
já contam esse chamado.

### 4.3 Preventiva automática
Cron diário gera um chamado por Local do escopo quando chega a data —
aparece na fila normal (`needsTriage: false`), dispatcher agenda a visita.

### 4.4 Consumo e excedente
Ficha do contrato mostra `used/amount` do mês civil corrente; passar do
`franchiseAmount` marca `exceeded: true` — só sinalização visual, sem
bloqueio nem cobrança nesta fase.

### 4.5 Vencimento próximo
30 dias antes do fim, ADMIN recebe e-mail. Renovar = editar `endDate`/
`monthlyValue` na ficha (não reseta `renewalWarnedAt` — limitação aceita: um
contrato renovado que se aproxima do fim de novo só avisa se `endDate` mudar
pra uma nova data futura e algum evento resetar o campo; nesta fase,
`PATCH` com `endDate` novo **sempre** limpa `renewalWarnedAt`, permitindo
novo aviso no próximo ciclo de 30 dias).

## 5. Erros e bordas

- `POST /contracts` com Local/Ativo de outro cliente → `400`.
- `endDate <= startDate` → `400`.
- `franchiseAmount <= 0` → `400`.
- Dois contratos ativos cobrindo o mesmo Local/Ativo → `resolveForTicket`
  usa o de `startDate` mais recente (sem erro, comportamento documentado).
- Cancelar contrato não desvincula chamados já criados (`contractId`
  permanece, só não gera mais preventiva nem entra em novo cálculo de
  franquia porque `status !== 'ACTIVE'` já exclui o contrato de
  `resolveForTicket` pra chamados futuros).
- Falha ao gerar preventiva de um contrato não impede os demais no mesmo
  ciclo do cron (log + segue, mesmo padrão do `SlaBreachCron`).
- Editar `endDate` do contrato sempre limpa `renewalWarnedAt` (permite novo
  aviso).

## 6. Testes

Unit (Vitest):
- `contracts.service` — CRUD, validação de escopo⊂cliente, `endDate>startDate`,
  `resolveForTicket` (sem match, um match, dois contratos → mais recente),
  cálculo de consumo (`VISITS` e `HOURS`, mês civil, excedente).
- `sla.service` — `dueAt` com `contractId` sem override (cai no global), com
  override (usa `ContractSlaPolicy`).
- `tickets.service` — `create`/`setTicketAssets` gravam `contractId`
  resolvido; chamado sem Local/Ativo não tenta resolver contrato.
- `contract-preventive.cron` — gera um chamado por Local do escopo, ativos
  corretos por Local, avança `nextGenerationAt`, contrato sem frequência
  não gera nada, falha num contrato não impede os demais.
- `contract-expiry.cron` — dispara só dentro da janela de 30 dias, não
  duplica com `renewalWarnedAt` já setado.

Integração (exige Postgres):
- Ciclo completo: criar contrato com escopo → abrir chamado no Local do
  escopo → `contractId` resolvido → SLA do contrato aplicado.
- Cron de preventiva ponta a ponta (chamado real criado no banco).

E2E Playwright (fumaça): criar contrato (Local + franquia) → abrir chamado
nesse Local → detalhe do chamado mostra o badge do contrato.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma + migração (`Contract`, `ContractSlaPolicy`, enums,
   `Ticket.contractId`, `TicketOrigin.CONTRACT`).
2. `contracts.service` — CRUD + validação de escopo + testes.
3. `contracts.service` — `resolveForTicket` + testes.
4. `contracts.service` — cálculo de consumo (`VISITS`/`HOURS`) + testes.
5. `contracts.controller` + `contracts.module` + registro no `app.module.ts`.
6. `tickets.service`: hook de `contractId` em `create`/`setTicketAssets` +
   inclusão no `findOne` + testes.
7. `sla.service`: `dueAt` com override de contrato + testes.
8. `ContractPreventiveCron` + testes.
9. `ContractExpiryCron` + template de e-mail + testes.
10. Integração + CHANGELOG.
11. Frontend: `lib/contracts.ts` (tipos + hooks).
12. Frontend: `/app/contratos` (lista) + `/app/contratos/novo` +
    `/app/contratos/[id]` (ficha completa).
13. Frontend: aba Contratos no cliente; badge de contrato no chamado.
14. E2E + release 0.5.0.

## 8. Versão

MINOR → **0.5.0** (funcionalidade nova, retrocompatível). Nenhuma env nova.
`CHANGELOG.md` em "Não lançado" durante o desenvolvimento.
