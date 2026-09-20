# Catálogo, Orçamento e Estoque (Fase 0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catálogo de serviços/produtos, estoque por depósito (com custo médio) e orçamentos aprováveis por link público que viram chamado.

**Architecture:** Três módulos NestJS novos e independentes (`catalog`, `stock`, `quotes`), seguindo exatamente o padrão do módulo `contracts` da 0.5.0. `stock` depende de `catalog` (valida `type: PRODUCT`); `quotes` depende de `catalog` (preço no momento do item) e de `tickets` (cria o chamado na aprovação avulsa via um método novo e fino em `TicketsService`, sem exigir `actor` — o mesmo padrão já usado pelo `ContractPreventiveCron`). Frontend replica a estrutura de `lib/contracts.ts` + páginas de `/app/contratos`.

**Tech Stack:** NestJS (ESM, imports relativos terminam em `.js`) + Prisma 6 + PostgreSQL; Next.js 14 App Router + React Query + shadcn/ui; Vitest (unit com Prisma mockado; `*.integration.spec.ts` com Postgres real, pula com aviso se `DATABASE_URL` ausente); Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-20-catalogo-orcamento-estoque-design.md`

## Global Constraints

- ESM em todo o backend: imports relativos sempre terminam em `.js`, mesmo mirando um `.ts` (`import { X } from './x.service.js'`).
- **Nunca `import type` para uma classe usada só como tipo de parâmetro de construtor** — isso apaga a referência de runtime que o Nest precisa pra resolver a injeção de dependência (lição da fase 0.4.0, `VisitReportService`). Sempre `import { X }` de valor nesse caso, mesmo que `X` não seja usado como valor no corpo do arquivo.
- IDs Prisma: `String @id @default(cuid())`. Dinheiro/quantidade: `Float` (mesmo padrão de `Contract.monthlyValue`), nunca `Decimal`.
- Migração é só aditiva — sem backfill, sem apagar coluna/tabela existente.
- Autorização: `@Roles('ADMIN','AGENT')` no controller (nível de classe) com `@Roles('ADMIN')` sobrescrevendo por rota onde a escrita é restrita; rotas do link público usam `@Public()` (`backend/src/common/public.decorator.ts`) e ficam **fora** de qualquer `@Roles`.
- Testes unit: Vitest, `PrismaService` mockado com `vi.fn()` (sem banco real) — mesmo estilo de `backend/src/contracts/contracts.service.spec.ts`. Testes de integração exigem Postgres (`docker compose up -d postgres`), ficam em `*.integration.spec.ts`, e pulam com `console.warn` + `return` cedo se `prisma.$connect()` falhar (nunca falham a suíte por falta de banco).
- Toda transação que precisa checar saldo/estado antes de gravar usa `this.prisma.$transaction(async (tx) => {...})` e lança a exceção **dentro** da callback — o Prisma reverte a transação automaticamente quando a promise rejeita.
- Preço/custo são sempre snapshot no momento do lançamento (`QuoteItem.unitPrice`, `TicketMaterialUsage.unitCost`) — nunca recalculados a partir do catálogo depois de gravados.

---

## Task 1: Schema Prisma — catálogo, estoque, orçamento + migração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_catalog_stock_quotes/migration.sql` (gerada)

**Interfaces:**
- Produces: enums `CatalogItemType`, `QuoteStatus`; modelos `CatalogItem`, `Warehouse`, `StockBalance`, `StockEntry`, `StockTransfer`, `TicketMaterialUsage`, `Quote`, `QuoteItem`, `QuoteCounter`; `Ticket.originQuoteId String?` + relação `originQuote`/`quotes`; `TicketOrigin` += `QUOTE`; `Client.quotes`, `Category.quotes` (relações reversas).

- [ ] **Step 1: Editar `schema.prisma` — `TicketOrigin`**

```prisma
enum TicketOrigin {
  EMAIL
  PORTAL
  MANUAL
  CONTRACT
  QUOTE
}
```

- [ ] **Step 2: Editar `schema.prisma` — enums novos**

Depois do enum `FranchiseUnit`, adicionar:

```prisma
enum CatalogItemType {
  SERVICE
  PRODUCT
}

enum QuoteStatus {
  DRAFT
  SENT
  APPROVED
  REJECTED
  SUPERSEDED
}
```

- [ ] **Step 3: Editar `schema.prisma` — `Client` e `Category` ganham a relação reversa**

No `model Client`, depois de `contracts Contract[]`:

```prisma
  quotes Quote[]
```

No `model Category`, depois de `contracts Contract[]`:

```prisma
  quotes Quote[]
```

- [ ] **Step 4: Editar `schema.prisma` — `Ticket`**

Adicionar o campo (perto de `contractId`):

```prisma
  originQuoteId   String?
```

E as relações (perto de `contract`):

```prisma
  originQuote   Quote?          @relation("TicketOriginQuote", fields: [originQuoteId], references: [id])
  quotes        Quote[]         @relation("QuoteTicket")
```

E o índice:

```prisma
  @@index([originQuoteId])
```

- [ ] **Step 5: Editar `schema.prisma` — modelos novos**

Adicionar depois do `model ContractSlaPolicy` (antes do `model CommentVisibility`/próximo model existente):

```prisma
model CatalogItem {
  id        String          @id @default(cuid())
  name      String
  type      CatalogItemType
  unit      String
  price     Float
  active    Boolean         @default(true)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  balances       StockBalance[]
  stockEntries   StockEntry[]
  stockTransfers StockTransfer[]
  materialUsages TicketMaterialUsage[]
  quoteItems     QuoteItem[]

  @@map("catalog_items")
}

model Warehouse {
  id        String   @id @default(cuid())
  name      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  balances       StockBalance[]
  entries        StockEntry[]
  transfersOut   StockTransfer[]       @relation("TransferFrom")
  transfersIn    StockTransfer[]       @relation("TransferTo")
  materialUsages TicketMaterialUsage[]

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

// Sequência própria (não reaproveita `Counter`, que numera chamados) —
// mesmo padrão transacional do `TicketNumberService`, chave só por ano.
model QuoteCounter {
  year  Int @id
  value Int @default(0)

  @@map("quote_counters")
}

model Quote {
  id          String      @id @default(cuid())
  number      Int
  clientId    String
  ticketId    String?
  categoryId  String?
  title       String?
  status      QuoteStatus @default(DRAFT)
  version     Int         @default(1)
  rootQuoteId String?
  publicToken String      @unique
  validUntil  DateTime?
  notes       String?
  sentAt      DateTime?
  approvedAt  DateTime?
  rejectedAt  DateTime?
  createdById String
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt

  client   Client      @relation(fields: [clientId], references: [id])
  ticket   Ticket?     @relation("QuoteTicket", fields: [ticketId], references: [id])
  category Category?   @relation(fields: [categoryId], references: [id])
  items    QuoteItem[]
  ticketsOriginated Ticket[] @relation("TicketOriginQuote")

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

- [ ] **Step 6: Validar e gerar a migração**

Rodar em `C:/Users/renan/os-exec/backend`:

```bash
npx prisma validate
npx prisma migrate dev --name add_catalog_stock_quotes
npx prisma generate
```

Expected: migração criada e aplicada sem erro; client regenerado com
`CatalogItem`, `Warehouse`, `StockBalance`, `StockEntry`, `StockTransfer`,
`TicketMaterialUsage`, `Quote`, `QuoteItem`, `QuoteCounter`,
`CatalogItemType`, `QuoteStatus`.

- [ ] **Step 7: Build de sanidade**

Run: `npm run build`
Expected: `nest build` compila sem erro de tipo.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(catalog): schema de catálogo, estoque e orçamentos"
```

---

## Task 2: Módulo `catalog` — CRUD de `CatalogItem`

**Files:**
- Create: `backend/src/catalog/catalog.service.ts`
- Create: `backend/src/catalog/catalog.controller.ts`
- Create: `backend/src/catalog/catalog.module.ts`
- Create: `backend/src/catalog/dto/create-catalog-item.dto.ts`
- Create: `backend/src/catalog/dto/update-catalog-item.dto.ts`
- Create: `backend/src/catalog/dto/list-catalog-items.dto.ts`
- Create: `backend/src/catalog/catalog.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `CatalogService.findAll(filter: ListCatalogItemsDto)`, `.findOne(id: string)`, `.create(dto: CreateCatalogItemDto)`, `.update(id: string, dto: UpdateCatalogItemDto)`. `CatalogItemType = 'SERVICE' | 'PRODUCT'`.

- [ ] **Step 1: DTOs**

`backend/src/catalog/dto/create-catalog-item.dto.ts`:

```ts
import { IsIn, IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateCatalogItemDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(['SERVICE', 'PRODUCT']) type!: 'SERVICE' | 'PRODUCT';
  @IsString() @MinLength(1) unit!: string;
  @IsNumber() @IsPositive() price!: number;
}
```

`backend/src/catalog/dto/update-catalog-item.dto.ts`:

```ts
import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class UpdateCatalogItemDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) unit?: string;
  @IsOptional() @IsNumber() @IsPositive() price?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

`backend/src/catalog/dto/list-catalog-items.dto.ts`:

```ts
import { IsBooleanString, IsIn, IsOptional } from 'class-validator';

export class ListCatalogItemsDto {
  @IsOptional() @IsIn(['SERVICE', 'PRODUCT']) type?: 'SERVICE' | 'PRODUCT';
  @IsOptional() @IsBooleanString() active?: string;
}
```

- [ ] **Step 2: Escrever o teste falhando de `catalog.service`**

`backend/src/catalog/catalog.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    catalogItem: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ci1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'ci1', name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150, active: true }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ci1', ...data })),
    },
    ...overrides,
  };
}

describe('CatalogService', () => {
  it('cria um item de catálogo', async () => {
    const prisma = makePrisma();
    const service = new CatalogService(prisma as any);
    const item = await service.create({ name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150 });
    expect(prisma.catalogItem.create).toHaveBeenCalledWith({
      data: { name: 'Instalação', type: 'SERVICE', unit: 'hora', price: 150 },
    });
    expect(item.id).toBe('ci1');
  });

  it('lança NotFoundException ao atualizar item inexistente', async () => {
    const prisma = makePrisma({ catalogItem: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() } });
    const service = new CatalogService(prisma as any);
    await expect(service.update('nope', { active: false })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atualiza campos parciais', async () => {
    const prisma = makePrisma();
    const service = new CatalogService(prisma as any);
    await service.update('ci1', { price: 200 });
    expect(prisma.catalogItem.update).toHaveBeenCalledWith({
      where: { id: 'ci1' },
      data: { price: 200 },
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- catalog.service.spec.ts`
Expected: FAIL — `Cannot find module './catalog.service.js'`.

- [ ] **Step 4: Implementar `CatalogService`**

`backend/src/catalog/catalog.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto.js';
import { ListCatalogItemsDto } from './dto/list-catalog-items.dto.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filter: ListCatalogItemsDto) {
    const where: Prisma.CatalogItemWhereInput = {};
    if (filter.type) where.type = filter.type;
    if (filter.active !== undefined) where.active = filter.active === 'true';
    return this.prisma.catalogItem.findMany({ where, orderBy: { name: 'asc' } });
  }

  private async mustFind(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item de catálogo não encontrado.');
    return item;
  }

  findOne(id: string) {
    return this.mustFind(id);
  }

  create(dto: CreateCatalogItemDto) {
    return this.prisma.catalogItem.create({
      data: { name: dto.name, type: dto.type, unit: dto.unit, price: dto.price },
    });
  }

  async update(id: string, dto: UpdateCatalogItemDto) {
    await this.mustFind(id);
    const data: Prisma.CatalogItemUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.catalogItem.update({ where: { id }, data });
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- catalog.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Controller e módulo**

`backend/src/catalog/catalog.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto.js';
import { ListCatalogItemsDto } from './dto/list-catalog-items.dto.js';

@Controller('catalog-items')
@Roles('ADMIN', 'AGENT')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  findAll(@Query() query: ListCatalogItemsDto) {
    return this.catalog.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateCatalogItemDto) {
    return this.catalog.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.catalog.update(id, dto);
  }
}
```

`backend/src/catalog/catalog.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
```

- [ ] **Step 7: Registrar no `app.module.ts`**

Adicionar o import e registrar `CatalogModule` no array `imports` (junto dos
demais módulos de domínio):

```ts
import { CatalogModule } from './catalog/catalog.module.js';
```

```ts
    CatalogModule,
```

- [ ] **Step 8: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 9: Commit**

```bash
git add backend/src/catalog backend/src/app.module.ts
git commit -m "feat(catalog): CRUD de itens do catálogo"
```

---

## Task 3: Módulo `stock` — depósitos e leitura de saldo

**Files:**
- Create: `backend/src/stock/stock.service.ts`
- Create: `backend/src/stock/dto/create-warehouse.dto.ts`
- Create: `backend/src/stock/dto/update-warehouse.dto.ts`
- Create: `backend/src/stock/dto/list-stock-balances.dto.ts`
- Create: `backend/src/stock/dto/update-stock-balance.dto.ts`
- Create: `backend/src/stock/stock.service.spec.ts`

**Interfaces:**
- Consumes: nenhuma interface de outro módulo desta fase ainda.
- Produces: `StockService.listWarehouses()`, `.createWarehouse(dto)`,
  `.updateWarehouse(id, dto)`, `.listBalances(filter)` (cada item com
  `belowMinimum: boolean`), `.updateMinQuantity(catalogItemId, warehouseId,
  minQuantity)`.

- [ ] **Step 1: DTOs**

`backend/src/stock/dto/create-warehouse.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class CreateWarehouseDto {
  @IsString() @MinLength(1) name!: string;
}
```

`backend/src/stock/dto/update-warehouse.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWarehouseDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

`backend/src/stock/dto/list-stock-balances.dto.ts`:

```ts
import { IsBooleanString, IsOptional, IsString } from 'class-validator';

export class ListStockBalancesDto {
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() catalogItemId?: string;
  @IsOptional() @IsBooleanString() belowMinimum?: string;
}
```

`backend/src/stock/dto/update-stock-balance.dto.ts`:

```ts
import { IsNumber, IsOptional, ValidateIf } from 'class-validator';

export class UpdateStockBalanceDto {
  // null = remove o mínimo (sem alerta).
  @ValidateIf((o) => o.minQuantity !== null) @IsOptional() @IsNumber()
  minQuantity!: number | null;
}
```

- [ ] **Step 2: Escrever os testes falhando**

`backend/src/stock/stock.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { StockService } from './stock.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    warehouse: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', active: true, ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 'w1', name: 'Almoxarifado', active: true }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', ...data })),
    },
    stockBalance: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockImplementation(({ create, update }: any) => Promise.resolve({ ...create, ...update })),
    },
    catalogItem: { findUnique: vi.fn() },
    ...overrides,
  };
}

describe('StockService — depósitos', () => {
  it('cria um depósito', async () => {
    const prisma = makePrisma();
    const service = new StockService(prisma as any);
    const w = await service.createWarehouse({ name: 'Van do João' });
    expect(prisma.warehouse.create).toHaveBeenCalledWith({ data: { name: 'Van do João' } });
    expect(w.id).toBe('w1');
  });

  it('bloqueia desativar depósito com saldo > 0', async () => {
    const prisma = makePrisma({
      stockBalance: { findFirst: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 5 }) },
    });
    const service = new StockService(prisma as any);
    await expect(service.updateWarehouse('w1', { active: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite desativar depósito sem saldo', async () => {
    const prisma = makePrisma();
    const service = new StockService(prisma as any);
    await service.updateWarehouse('w1', { active: false });
    expect(prisma.warehouse.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { name: 'Almoxarifado', active: false },
    });
  });
});

describe('StockService — saldos', () => {
  it('marca belowMinimum quando quantity < minQuantity', async () => {
    const prisma = makePrisma({
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2, minQuantity: 5, avgCost: 10 },
          { catalogItemId: 'ci2', warehouseId: 'w1', quantity: 20, minQuantity: 5, avgCost: 10 },
        ]),
      },
    });
    const service = new StockService(prisma as any);
    const balances = await service.listBalances({});
    expect(balances.find((b) => b.catalogItemId === 'ci1')!.belowMinimum).toBe(true);
    expect(balances.find((b) => b.catalogItemId === 'ci2')!.belowMinimum).toBe(false);
  });

  it('filtra só os abaixo do mínimo quando pedido', async () => {
    const prisma = makePrisma({
      stockBalance: {
        findMany: vi.fn().mockResolvedValue([
          { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2, minQuantity: 5, avgCost: 10 },
          { catalogItemId: 'ci2', warehouseId: 'w1', quantity: 20, minQuantity: 5, avgCost: 10 },
        ]),
      },
    });
    const service = new StockService(prisma as any);
    const balances = await service.listBalances({ belowMinimum: 'true' });
    expect(balances).toHaveLength(1);
    expect(balances[0].catalogItemId).toBe('ci1');
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- stock.service.spec.ts`
Expected: FAIL — `Cannot find module './stock.service.js'`.

- [ ] **Step 4: Implementar `StockService` (depósitos + saldos)**

`backend/src/stock/stock.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto.js';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  listWarehouses() {
    return this.prisma.warehouse.findMany({ orderBy: { name: 'asc' } });
  }

  createWarehouse(dto: CreateWarehouseDto) {
    return this.prisma.warehouse.create({ data: { name: dto.name } });
  }

  private async mustFindWarehouse(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({ where: { id } });
    if (!warehouse) throw new NotFoundException('Depósito não encontrado.');
    return warehouse;
  }

  async updateWarehouse(id: string, dto: UpdateWarehouseDto) {
    const warehouse = await this.mustFindWarehouse(id);
    if (dto.active === false) {
      const hasStock = await this.prisma.stockBalance.findFirst({
        where: { warehouseId: id, quantity: { gt: 0 } },
      });
      if (hasStock) throw new BadRequestException('Zere o saldo do depósito antes de desativar.');
    }
    return this.prisma.warehouse.update({
      where: { id },
      data: { name: dto.name ?? warehouse.name, active: dto.active ?? warehouse.active },
    });
  }

  async listBalances(filter: ListStockBalancesDto) {
    const where: Prisma.StockBalanceWhereInput = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.catalogItemId) where.catalogItemId = filter.catalogItemId;
    const balances = await this.prisma.stockBalance.findMany({
      where,
      include: {
        catalogItem: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });
    const withFlag = balances.map((b) => ({
      ...b,
      belowMinimum: b.minQuantity != null && b.quantity < b.minQuantity,
    }));
    return filter.belowMinimum === 'true' ? withFlag.filter((b) => b.belowMinimum) : withFlag;
  }

  updateMinQuantity(catalogItemId: string, warehouseId: string, minQuantity: number | null) {
    return this.prisma.stockBalance.upsert({
      where: { catalogItemId_warehouseId: { catalogItemId, warehouseId } },
      create: { catalogItemId, warehouseId, minQuantity },
      update: { minQuantity },
    });
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- stock.service.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/stock
git commit -m "feat(stock): depósitos e leitura de saldo com alerta de mínimo"
```

---

## Task 4: `StockService` — entrada de estoque com custo médio

**Files:**
- Create: `backend/src/stock/dto/create-stock-entry.dto.ts`
- Modify: `backend/src/stock/stock.service.ts`
- Modify: `backend/src/stock/stock.service.spec.ts`

**Interfaces:**
- Produces: `StockService.createEntry(dto: CreateStockEntryDto, createdById: string)`.

- [ ] **Step 1: DTO**

`backend/src/stock/dto/create-stock-entry.dto.ts`:

```ts
import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateStockEntryDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsNumber() @IsPositive() unitCost!: number;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 2: Escrever o teste falhando**

Adicionar a `stock.service.spec.ts` (o `makePrisma` do Step 2 da Task 3
ganha `stockEntry.create` e `$transaction`):

```ts
function makePrismaWithTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    stockEntry: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'se1', ...data })) },
    stockBalance: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve(create)),
    },
    ...overrides,
  };
  return {
    catalogItem: { findUnique: vi.fn().mockResolvedValue({ id: 'ci1', type: 'PRODUCT' }) },
    warehouse: { findUnique: vi.fn().mockResolvedValue({ id: 'w1', active: true }) },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    tx,
  };
}

describe('StockService — entrada de estoque', () => {
  it('rejeita item que não é PRODUCT', async () => {
    const prisma = makePrismaWithTx({});
    prisma.catalogItem.findUnique = vi.fn().mockResolvedValue({ id: 'ci1', type: 'SERVICE' });
    const service = new StockService(prisma as any);
    await expect(
      service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 5 }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria saldo do zero com avgCost = custo da entrada', async () => {
    const prisma = makePrismaWithTx();
    const service = new StockService(prisma as any);
    await service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 5 }, 'user1');
    expect(prisma.tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: 10, avgCost: 5 }),
      }),
    );
  });

  it('pondera avgCost quando já existe saldo', async () => {
    const prisma = makePrismaWithTx({
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, avgCost: 5 }),
        upsert: vi.fn().mockImplementation(({ update }: any) => Promise.resolve(update)),
      },
    });
    const service = new StockService(prisma as any);
    await service.createEntry({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, unitCost: 15 }, 'user1');
    // (10*5 + 10*15) / 20 = 10
    expect(prisma.tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ quantity: 20, avgCost: 10 }) }),
    );
  });
});
```

Importar `BadRequestException` de `@nestjs/common` no topo do arquivo de
teste (já feito na Task 3 se seguida em ordem — senão adicionar ao import
existente).

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- stock.service.spec.ts`
Expected: FAIL — `service.createEntry is not a function`.

- [ ] **Step 4: Implementar `createEntry`**

Adicionar a `backend/src/stock/stock.service.ts` (import `CreateStockEntryDto`
no topo):

```ts
  private async mustFindCatalogItem(id: string) {
    const item = await this.prisma.catalogItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item de catálogo não encontrado.');
    return item;
  }

  async createEntry(dto: CreateStockEntryDto, createdById: string) {
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }
    await this.mustFindWarehouse(dto.warehouseId);

    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.stockEntry.create({
        data: {
          catalogItemId: dto.catalogItemId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          unitCost: dto.unitCost,
          notes: dto.notes ?? null,
          createdById,
        },
      });
      const balance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
      });
      const currentQty = balance?.quantity ?? 0;
      const currentAvg = balance?.avgCost ?? 0;
      const newQty = currentQty + dto.quantity;
      const newAvg =
        currentQty === 0 ? dto.unitCost : (currentQty * currentAvg + dto.quantity * dto.unitCost) / newQty;
      await tx.stockBalance.upsert({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
        create: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId, quantity: dto.quantity, avgCost: dto.unitCost },
        update: { quantity: newQty, avgCost: newAvg },
      });
      return entry;
    });
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- stock.service.spec.ts`
Expected: PASS (8 testes no total).

- [ ] **Step 6: Commit**

```bash
git add backend/src/stock
git commit -m "feat(stock): entrada de estoque com custo médio ponderado"
```

---

## Task 5: `StockService` — transferência entre depósitos

**Files:**
- Create: `backend/src/stock/dto/create-stock-transfer.dto.ts`
- Modify: `backend/src/stock/stock.service.ts`
- Modify: `backend/src/stock/stock.service.spec.ts`

**Interfaces:**
- Produces: `StockService.createTransfer(dto: CreateStockTransferDto, createdById: string)`.

- [ ] **Step 1: DTO**

`backend/src/stock/dto/create-stock-transfer.dto.ts`:

```ts
import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateStockTransferDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) fromWarehouseId!: string;
  @IsString() @MinLength(1) toWarehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
  @IsOptional() @IsString() notes?: string;
}
```

- [ ] **Step 2: Escrever o teste falhando**

Adicionar a `stock.service.spec.ts`:

```ts
describe('StockService — transferência', () => {
  it('rejeita origem igual ao destino', async () => {
    const prisma = makePrismaWithTx();
    const service = new StockService(prisma as any);
    await expect(
      service.createTransfer(
        { catalogItemId: 'ci1', fromWarehouseId: 'w1', toWarehouseId: 'w1', quantity: 5 },
        'user1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita saldo insuficiente na origem', async () => {
    const prisma = makePrismaWithTx({
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2, avgCost: 10 }),
        update: vi.fn(),
        upsert: vi.fn(),
      },
    });
    const service = new StockService(prisma as any);
    await expect(
      service.createTransfer(
        { catalogItemId: 'ci1', fromWarehouseId: 'w1', toWarehouseId: 'w2', quantity: 5 },
        'user1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('move saldo com o mesmo avgCost quando destino está vazio', async () => {
    let fromCalls = 0;
    const prisma = makePrismaWithTx({
      stockBalance: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          fromCalls++;
          if (fromCalls === 1) return Promise.resolve({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 20, avgCost: 10 });
          return Promise.resolve(null); // destino vazio
        }),
        update: vi.fn(),
        upsert: vi.fn().mockImplementation(({ create }: any) => Promise.resolve(create)),
      },
      stockTransfer: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'st1', ...data })) },
    });
    const service = new StockService(prisma as any);
    await service.createTransfer(
      { catalogItemId: 'ci1', fromWarehouseId: 'w1', toWarehouseId: 'w2', quantity: 5 },
      'user1',
    );
    expect(prisma.tx.stockBalance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ quantity: 5, avgCost: 10 }) }),
    );
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- stock.service.spec.ts`
Expected: FAIL — `service.createTransfer is not a function`.

- [ ] **Step 4: Implementar `createTransfer`**

Adicionar a `backend/src/stock/stock.service.ts` (import `CreateStockTransferDto`):

```ts
  async createTransfer(dto: CreateStockTransferDto, createdById: string) {
    if (dto.fromWarehouseId === dto.toWarehouseId) {
      throw new BadRequestException('Origem e destino não podem ser o mesmo depósito.');
    }
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }
    await this.mustFindWarehouse(dto.fromWarehouseId);
    await this.mustFindWarehouse(dto.toWarehouseId);

    return this.prisma.$transaction(async (tx) => {
      const fromBalance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.fromWarehouseId } },
      });
      if (!fromBalance || fromBalance.quantity < dto.quantity) {
        throw new BadRequestException('Saldo insuficiente no depósito de origem.');
      }
      await tx.stockBalance.update({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.fromWarehouseId } },
        data: { quantity: { decrement: dto.quantity } },
      });
      const toBalance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId } },
      });
      const currentQty = toBalance?.quantity ?? 0;
      const currentAvg = toBalance?.avgCost ?? 0;
      const newQty = currentQty + dto.quantity;
      const newAvg =
        currentQty === 0 ? fromBalance.avgCost : (currentQty * currentAvg + dto.quantity * fromBalance.avgCost) / newQty;
      await tx.stockBalance.upsert({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId } },
        create: { catalogItemId: dto.catalogItemId, warehouseId: dto.toWarehouseId, quantity: dto.quantity, avgCost: fromBalance.avgCost },
        update: { quantity: newQty, avgCost: newAvg },
      });
      return tx.stockTransfer.create({
        data: {
          catalogItemId: dto.catalogItemId,
          fromWarehouseId: dto.fromWarehouseId,
          toWarehouseId: dto.toWarehouseId,
          quantity: dto.quantity,
          notes: dto.notes ?? null,
          createdById,
        },
      });
    });
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- stock.service.spec.ts`
Expected: PASS (11 testes no total).

- [ ] **Step 6: Commit**

```bash
git add backend/src/stock
git commit -m "feat(stock): transferência atômica entre depósitos"
```

---

## Task 6: `StockService` — requisição de material no chamado

**Files:**
- Create: `backend/src/stock/dto/create-material-usage.dto.ts`
- Modify: `backend/src/stock/stock.service.ts`
- Modify: `backend/src/stock/stock.service.spec.ts`

**Interfaces:**
- Produces: `StockService.registerMaterialUsage(ticketId: string, dto: CreateMaterialUsageDto, createdById: string)`, `.listMaterialUsages(ticketId: string)`.

- [ ] **Step 1: DTO**

`backend/src/stock/dto/create-material-usage.dto.ts`:

```ts
import { IsNumber, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateMaterialUsageDto {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsString() @MinLength(1) warehouseId!: string;
  @IsNumber() @IsPositive() quantity!: number;
}
```

- [ ] **Step 2: Escrever o teste falhando**

Adicionar a `stock.service.spec.ts`:

```ts
describe('StockService — requisição de material', () => {
  function makePrismaForUsage(overrides: Record<string, unknown> = {}) {
    const tx = {
      stockBalance: {
        findUnique: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 10, avgCost: 7 }),
        update: vi.fn(),
      },
      ticketMaterialUsage: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'tmu1', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
      },
      ...overrides,
    };
    return {
      ticket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'IN_PROGRESS' }) },
      catalogItem: { findUnique: vi.fn().mockResolvedValue({ id: 'ci1', type: 'PRODUCT' }) },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
      ticketMaterialUsage: tx.ticketMaterialUsage,
      tx,
    };
  }

  it('rejeita chamado fechado', async () => {
    const prisma = makePrismaForUsage();
    prisma.ticket.findUnique = vi.fn().mockResolvedValue({ id: 't1', status: 'CLOSED' });
    const service = new StockService(prisma as any);
    await expect(
      service.registerMaterialUsage('t1', { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 2 }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita saldo insuficiente', async () => {
    const prisma = makePrismaForUsage({
      stockBalance: { findUnique: vi.fn().mockResolvedValue({ catalogItemId: 'ci1', warehouseId: 'w1', quantity: 1, avgCost: 7 }), update: vi.fn() },
    });
    const service = new StockService(prisma as any);
    await expect(
      service.registerMaterialUsage('t1', { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 5 }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('baixa o saldo e grava o custo médio como snapshot', async () => {
    const prisma = makePrismaForUsage();
    const service = new StockService(prisma as any);
    const usage = await service.registerMaterialUsage(
      't1',
      { catalogItemId: 'ci1', warehouseId: 'w1', quantity: 3 },
      'user1',
    );
    expect(prisma.tx.stockBalance.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { decrement: 3 } } }),
    );
    expect(usage.unitCost).toBe(7);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- stock.service.spec.ts`
Expected: FAIL — `service.registerMaterialUsage is not a function`.

- [ ] **Step 4: Implementar `registerMaterialUsage` e `listMaterialUsages`**

Adicionar a `backend/src/stock/stock.service.ts` (import `CreateMaterialUsageDto`):

```ts
  async registerMaterialUsage(ticketId: string, dto: CreateMaterialUsageDto, createdById: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');
    if (ticket.status === 'CLOSED') {
      throw new BadRequestException('Chamado fechado não aceita novo material.');
    }
    const item = await this.mustFindCatalogItem(dto.catalogItemId);
    if (item.type !== 'PRODUCT') {
      throw new BadRequestException('Só itens do tipo PRODUCT participam de estoque.');
    }

    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.findUnique({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
      });
      if (!balance || balance.quantity < dto.quantity) {
        throw new BadRequestException('Saldo insuficiente no depósito informado.');
      }
      await tx.stockBalance.update({
        where: { catalogItemId_warehouseId: { catalogItemId: dto.catalogItemId, warehouseId: dto.warehouseId } },
        data: { quantity: { decrement: dto.quantity } },
      });
      return tx.ticketMaterialUsage.create({
        data: {
          ticketId,
          catalogItemId: dto.catalogItemId,
          warehouseId: dto.warehouseId,
          quantity: dto.quantity,
          unitCost: balance.avgCost,
          createdById,
        },
      });
    });
  }

  listMaterialUsages(ticketId: string) {
    return this.prisma.ticketMaterialUsage.findMany({
      where: { ticketId },
      include: {
        catalogItem: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- stock.service.spec.ts`
Expected: PASS (14 testes no total).

- [ ] **Step 6: Commit**

```bash
git add backend/src/stock
git commit -m "feat(stock): requisição de material baixa direta no chamado"
```

---

## Task 7: `stock.controller`/`stock.module` + registro no `app.module.ts`

**Files:**
- Create: `backend/src/stock/stock.controller.ts`
- Create: `backend/src/stock/ticket-material-usages.controller.ts`
- Create: `backend/src/stock/stock.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: todos os métodos de `StockService` das Tasks 3–6.
- Produces: rotas HTTP de `stock` prontas pra uso pelo frontend.

- [ ] **Step 1: `StockController` (depósitos, saldos, entradas, transferências)**

`backend/src/stock/stock.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { StockService } from './stock.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto.js';
import { ListStockBalancesDto } from './dto/list-stock-balances.dto.js';
import { UpdateStockBalanceDto } from './dto/update-stock-balance.dto.js';
import { CreateStockEntryDto } from './dto/create-stock-entry.dto.js';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto.js';

@Controller()
@Roles('ADMIN', 'AGENT')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('warehouses')
  listWarehouses() {
    return this.stock.listWarehouses();
  }

  @Post('warehouses')
  @Roles('ADMIN')
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.stock.createWarehouse(dto);
  }

  @Patch('warehouses/:id')
  @Roles('ADMIN')
  updateWarehouse(@Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
    return this.stock.updateWarehouse(id, dto);
  }

  @Get('stock/balances')
  listBalances(@Query() query: ListStockBalancesDto) {
    return this.stock.listBalances(query);
  }

  @Patch('stock/balances/:catalogItemId/:warehouseId')
  @Roles('ADMIN')
  updateMinQuantity(
    @Param('catalogItemId') catalogItemId: string,
    @Param('warehouseId') warehouseId: string,
    @Body() dto: UpdateStockBalanceDto,
  ) {
    return this.stock.updateMinQuantity(catalogItemId, warehouseId, dto.minQuantity);
  }

  @Post('stock/entries')
  createEntry(@Body() dto: CreateStockEntryDto, @Req() req: Request) {
    return this.stock.createEntry(dto, (req as any).user.id);
  }

  @Post('stock/transfers')
  createTransfer(@Body() dto: CreateStockTransferDto, @Req() req: Request) {
    return this.stock.createTransfer(dto, (req as any).user.id);
  }
}
```

- [ ] **Step 2: `TicketMaterialUsagesController`**

`backend/src/stock/ticket-material-usages.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { StockService } from './stock.service.js';
import { CreateMaterialUsageDto } from './dto/create-material-usage.dto.js';

@Controller('tickets/:ticketId/material-usages')
@Roles('ADMIN', 'AGENT')
export class TicketMaterialUsagesController {
  constructor(private readonly stock: StockService) {}

  @Get()
  list(@Param('ticketId') ticketId: string) {
    return this.stock.listMaterialUsages(ticketId);
  }

  @Post()
  register(@Param('ticketId') ticketId: string, @Body() dto: CreateMaterialUsageDto, @Req() req: Request) {
    return this.stock.registerMaterialUsage(ticketId, dto, (req as any).user.id);
  }
}
```

> Confira em `backend/src/tickets/tickets.controller.ts` como o `req.user.id`
> já é lido nas rotas autenticadas existentes (mesmo padrão de acesso ao
> ator via `JwtAuthGuard`); se o projeto usa um decorator `@CurrentUser()`
> em vez de `@Req()`, use-o aqui pra manter consistência — ele está em
> `backend/src/auth/current-user.decorator.ts` quando existir.

- [ ] **Step 3: `StockModule`**

`backend/src/stock/stock.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { StockController } from './stock.controller.js';
import { TicketMaterialUsagesController } from './ticket-material-usages.controller.js';
import { StockService } from './stock.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [StockController, TicketMaterialUsagesController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
```

- [ ] **Step 4: Registrar no `app.module.ts`**

```ts
import { StockModule } from './stock/stock.module.js';
```

```ts
    StockModule,
```

- [ ] **Step 5: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 6: Rodar toda a suíte unit**

Run: `npm run test`
Expected: PASS, sem regressão nos módulos existentes.

- [ ] **Step 7: Commit**

```bash
git add backend/src/stock backend/src/app.module.ts
git commit -m "feat(stock): rotas de depósitos, saldos, entradas, transferências e requisição"
```

---

## Task 8: `QuoteNumberService`

**Files:**
- Create: `backend/src/quotes/quote-number.service.ts`
- Create: `backend/src/quotes/quote-number.service.spec.ts`

**Interfaces:**
- Produces: `QuoteNumberService.next(tx: Prisma.TransactionClient, year?: number): Promise<number>`.

- [ ] **Step 1: Escrever o teste falhando**

`backend/src/quotes/quote-number.service.spec.ts`:

```ts
import { QuoteNumberService } from './quote-number.service.js';

describe('QuoteNumberService', () => {
  it('incrementa o contador do ano e devolve o valor', async () => {
    const tx = {
      quoteCounter: {
        upsert: vi.fn().mockResolvedValue({ year: 2026, value: 1 }),
      },
    };
    const service = new QuoteNumberService();
    const number = await service.next(tx as any, 2026);
    expect(number).toBe(1);
    expect(tx.quoteCounter.upsert).toHaveBeenCalledWith({
      where: { year: 2026 },
      create: { year: 2026, value: 1 },
      update: { value: { increment: 1 } },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- quote-number.service.spec.ts`
Expected: FAIL — `Cannot find module './quote-number.service.js'`.

- [ ] **Step 3: Implementar**

`backend/src/quotes/quote-number.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

@Injectable()
export class QuoteNumberService {
  /** Sequência própria por ano civil — não compartilha contador com `TicketNumberService`. */
  async next(
    tx: Prisma.TransactionClient,
    year: number = new Date().getFullYear(),
  ): Promise<number> {
    const counter = await tx.quoteCounter.upsert({
      where: { year },
      create: { year, value: 1 },
      update: { value: { increment: 1 } },
    });
    return counter.value;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- quote-number.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/quotes
git commit -m "feat(quotes): numeração sequencial por ano civil"
```

---

## Task 9: Módulo `quotes` — criação, listagem e detalhe

**Files:**
- Create: `backend/src/quotes/quotes.service.ts`
- Create: `backend/src/quotes/dto/quote-item.dto.ts`
- Create: `backend/src/quotes/dto/create-quote.dto.ts`
- Create: `backend/src/quotes/dto/list-quotes.dto.ts`
- Create: `backend/src/quotes/quotes.service.spec.ts`

**Interfaces:**
- Consumes: `QuoteNumberService.next(tx, year?)` (Task 8).
- Produces: `QuotesService.create(dto: CreateQuoteDto, createdById: string)`,
  `.findAll(filter: ListQuotesDto)`, `.findOne(id: string)` (inclui `total`
  calculado).

- [ ] **Step 1: DTOs**

`backend/src/quotes/dto/quote-item.dto.ts`:

```ts
import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class QuoteItemInput {
  @IsString() @MinLength(1) catalogItemId!: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @IsPositive() quantity!: number;
  // Se ausente, o service usa o preço atual do CatalogItem no momento da criação.
  @IsOptional() @IsNumber() @IsPositive() unitPrice?: number;
}
```

`backend/src/quotes/dto/create-quote.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { QuoteItemInput } from './quote-item.dto.js';

export class CreateQuoteDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemInput)
  items!: QuoteItemInput[];
}
```

`backend/src/quotes/dto/list-quotes.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED'] as const;

export class ListQuotesDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}
```

- [ ] **Step 2: Escrever o teste falhando**

`backend/src/quotes/quotes.service.spec.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QuotesService } from './quotes.service.js';

vi.mock('node:crypto', async () => {
  const actual = await vi.importActual<typeof import('node:crypto')>('node:crypto');
  return { ...actual, randomBytes: vi.fn(() => Buffer.from('a'.repeat(24))) };
});

function makePrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    quoteCounter: { upsert: vi.fn().mockResolvedValue({ year: 2026, value: 1 }) },
    quote: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data, items: data.items?.create ?? [] })),
    },
    ...overrides,
  };
  return {
    catalogItem: { findMany: vi.fn().mockResolvedValue([{ id: 'ci1', price: 100 }]) },
    ticket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', clientId: 'cli1' }) },
    quote: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 'q1',
        clientId: 'cli1',
        items: [{ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 }],
      }),
    },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
    tx,
    ...overrides,
  };
}

describe('QuotesService.create', () => {
  it('exige categoryId e title quando não há ticketId', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any);
    await expect(
      service.create({ clientId: 'cli1', items: [{ catalogItemId: 'ci1', quantity: 1 }] }, 'user1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita ticket de outro cliente', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any);
    await expect(
      service.create(
        { clientId: 'outro-cliente', ticketId: 't1', items: [{ catalogItemId: 'ci1', quantity: 1 }] },
        'user1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('usa o preço do catálogo quando unitPrice não é informado', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any);
    await service.create(
      { clientId: 'cli1', ticketId: 't1', items: [{ catalogItemId: 'ci1', quantity: 2 }] },
      'user1',
    );
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: { create: [expect.objectContaining({ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 })] },
        }),
      }),
    );
  });

  it('cria orçamento avulso com categoria e título', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any);
    const quote = await service.create(
      { clientId: 'cli1', categoryId: 'cat1', title: 'Instalação nova', items: [{ catalogItemId: 'ci1', quantity: 1, unitPrice: 500 }] },
      'user1',
    );
    expect(quote.id).toBe('q1');
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', version: 1, number: 1 }) }),
    );
  });
});

describe('QuotesService.findOne', () => {
  it('calcula o total a partir dos itens', async () => {
    const prisma = makePrisma();
    const service = new QuotesService(prisma as any);
    const quote = await service.findOne('q1');
    expect(quote.total).toBe(200);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- quotes.service.spec.ts`
Expected: FAIL — `Cannot find module './quotes.service.js'`.

- [ ] **Step 4: Implementar `QuotesService` (parte 1)**

`backend/src/quotes/quotes.service.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuoteNumberService } from './quote-number.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { ListQuotesDto } from './dto/list-quotes.dto.js';

const QUOTE_INCLUDE = {
  client: { select: { id: true, name: true } },
  ticket: { select: { id: true, number: true } },
  category: { select: { id: true, name: true } },
  items: { include: { catalogItem: { select: { id: true, name: true, unit: true } } } },
} as const;

function withTotal<T extends { items: { quantity: number; unitPrice: number }[] }>(quote: T) {
  const total = quote.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  return { ...quote, total };
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteNumber: QuoteNumberService,
  ) {}

  findAll(filter: ListQuotesDto) {
    const where: Prisma.QuoteWhereInput = {};
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.ticketId) where.ticketId = filter.ticketId;
    if (filter.status) where.status = filter.status;
    return this.prisma.quote.findMany({ where, include: QUOTE_INCLUDE, orderBy: { createdAt: 'desc' } });
  }

  private async mustFind(id: string) {
    const quote = await this.prisma.quote.findUnique({ where: { id }, include: QUOTE_INCLUDE });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');
    return quote;
  }

  async findOne(id: string) {
    return withTotal(await this.mustFind(id));
  }

  async create(dto: CreateQuoteDto, createdById: string) {
    if (!dto.ticketId && (!dto.categoryId || !dto.title)) {
      throw new BadRequestException('Orçamento avulso exige categoryId e title.');
    }
    if (dto.ticketId) {
      const ticket = await this.prisma.ticket.findUnique({ where: { id: dto.ticketId } });
      if (!ticket) throw new BadRequestException('Chamado não encontrado.');
      if (ticket.clientId !== dto.clientId) {
        throw new BadRequestException('O chamado não pertence ao cliente informado.');
      }
    }
    const catalogItems = await this.prisma.catalogItem.findMany({
      where: { id: { in: dto.items.map((i) => i.catalogItemId) } },
    });
    if (catalogItems.length !== new Set(dto.items.map((i) => i.catalogItemId)).size) {
      throw new BadRequestException('Um ou mais itens do catálogo não existem.');
    }
    const priceById = new Map(catalogItems.map((c) => [c.id, c.price]));

    const created = await this.prisma.$transaction(async (tx) => {
      const number = await this.quoteNumber.next(tx);
      return tx.quote.create({
        data: {
          number,
          clientId: dto.clientId,
          ticketId: dto.ticketId ?? null,
          categoryId: dto.categoryId ?? null,
          title: dto.title ?? null,
          status: 'DRAFT',
          version: 1,
          publicToken: randomBytes(24).toString('hex'),
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          notes: dto.notes ?? null,
          createdById,
          items: {
            create: dto.items.map((i) => ({
              catalogItemId: i.catalogItemId,
              description: i.description ?? null,
              quantity: i.quantity,
              unitPrice: i.unitPrice ?? priceById.get(i.catalogItemId)!,
            })),
          },
        },
      });
    });
    return this.findOne(created.id);
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- quotes.service.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/quotes
git commit -m "feat(quotes): criação, listagem e detalhe do orçamento"
```

---

## Task 10: `QuotesService` — update (DRAFT) e send

**Files:**
- Create: `backend/src/quotes/dto/update-quote.dto.ts`
- Modify: `backend/src/quotes/quotes.service.ts`
- Modify: `backend/src/quotes/quotes.service.spec.ts`

**Interfaces:**
- Produces: `QuotesService.update(id: string, dto: UpdateQuoteDto)`, `.send(id: string)`.

- [ ] **Step 1: DTO**

`backend/src/quotes/dto/update-quote.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator';
import { QuoteItemInput } from './quote-item.dto.js';

export class UpdateQuoteDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsISO8601() validUntil?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemInput)
  items?: QuoteItemInput[];
}
```

- [ ] **Step 2: Escrever o teste falhando**

Adicionar a `quotes.service.spec.ts` (o `makePrisma` ganha
`quote.findUnique` retornando `status: 'DRAFT'` por padrão nesse bloco):

```ts
describe('QuotesService.update / send', () => {
  function makeDraftPrisma(overrides: Record<string, unknown> = {}) {
    const base = makePrisma(overrides);
    base.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1',
      clientId: 'cli1',
      status: 'DRAFT',
      items: [{ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 }],
    });
    base.tx.quote.update = vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data }));
    base.tx.quoteItem = { deleteMany: vi.fn(), createMany: vi.fn() };
    return base;
  }

  it('rejeita update fora de DRAFT', async () => {
    const prisma = makeDraftPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'SENT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.update('q1', { title: 'X' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('atualiza campos e substitui itens em DRAFT', async () => {
    const prisma = makeDraftPrisma();
    const service = new QuotesService(prisma as any, {} as any);
    await service.update('q1', { title: 'Novo título', items: [{ catalogItemId: 'ci1', quantity: 3, unitPrice: 90 }] });
    expect(prisma.tx.quoteItem.deleteMany).toHaveBeenCalledWith({ where: { quoteId: 'q1' } });
    expect(prisma.tx.quoteItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quoteId: 'q1', catalogItemId: 'ci1', quantity: 3, unitPrice: 90 })],
    });
  });

  it('rejeita enviar orçamento sem itens', async () => {
    const prisma = makeDraftPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'DRAFT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.send('q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('envia DRAFT com itens, marcando SENT + sentAt', async () => {
    const prisma = makeDraftPrisma();
    const service = new QuotesService(prisma as any, {} as any);
    await service.send('q1');
    expect(prisma.quote.update ?? prisma.tx.quote.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- quotes.service.spec.ts`
Expected: FAIL — `service.update is not a function`.

- [ ] **Step 4: Implementar `update` e `send`**

Adicionar a `backend/src/quotes/quotes.service.ts` (import `UpdateQuoteDto`):

```ts
  async update(id: string, dto: UpdateQuoteDto) {
    const quote = await this.mustFind(id);
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException('Só é possível editar orçamentos em rascunho. Use /revise para enviados.');
    }
    let priceById = new Map<string, number>();
    if (dto.items) {
      const catalogItems = await this.prisma.catalogItem.findMany({
        where: { id: { in: dto.items.map((i) => i.catalogItemId) } },
      });
      priceById = new Map(catalogItems.map((c) => [c.id, c.price]));
    }
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.QuoteUncheckedUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.categoryId !== undefined) data.categoryId = dto.categoryId;
      if (dto.validUntil !== undefined) data.validUntil = new Date(dto.validUntil);
      if (dto.notes !== undefined) data.notes = dto.notes;
      await tx.quote.update({ where: { id }, data });
      if (dto.items) {
        await tx.quoteItem.deleteMany({ where: { quoteId: id } });
        await tx.quoteItem.createMany({
          data: dto.items.map((i) => ({
            quoteId: id,
            catalogItemId: i.catalogItemId,
            description: i.description ?? null,
            quantity: i.quantity,
            unitPrice: i.unitPrice ?? priceById.get(i.catalogItemId)!,
          })),
        });
      }
    });
    return this.findOne(id);
  }

  async send(id: string) {
    const quote = await this.mustFind(id);
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException('Só é possível enviar orçamentos em rascunho.');
    }
    if (quote.items.length === 0) {
      throw new BadRequestException('Adicione ao menos um item antes de enviar.');
    }
    await this.prisma.quote.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
    return this.findOne(id);
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- quotes.service.spec.ts`
Expected: PASS (9 testes no total).

- [ ] **Step 6: Commit**

```bash
git add backend/src/quotes
git commit -m "feat(quotes): edição em rascunho e envio"
```

---

## Task 11: `QuotesService` — revisão (nova versão)

**Files:**
- Modify: `backend/src/quotes/quotes.service.ts`
- Modify: `backend/src/quotes/quotes.service.spec.ts`

**Interfaces:**
- Produces: `QuotesService.revise(id: string)`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `quotes.service.spec.ts`:

```ts
describe('QuotesService.revise', () => {
  function makeSentPrisma() {
    const prisma = makePrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1',
      number: 1,
      clientId: 'cli1',
      ticketId: null,
      categoryId: 'cat1',
      title: 'Instalação',
      status: 'SENT',
      version: 1,
      rootQuoteId: null,
      validUntil: null,
      notes: null,
      createdById: 'user1',
      items: [{ catalogItemId: 'ci1', description: null, quantity: 2, unitPrice: 100 }],
    });
    prisma.tx.quote.update = vi.fn();
    return prisma;
  }

  it('rejeita revisar orçamento em DRAFT', async () => {
    const prisma = makeSentPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'DRAFT', items: [] });
    const service = new QuotesService(prisma as any, {} as any);
    await expect(service.revise('q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('supersede a versão atual e cria uma nova DRAFT com os mesmos itens', async () => {
    const prisma = makeSentPrisma();
    const service = new QuotesService(prisma as any, {} as any);
    await service.revise('q1');
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: { status: 'SUPERSEDED' } });
    expect(prisma.tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          number: 1,
          version: 2,
          rootQuoteId: 'q1',
          status: 'DRAFT',
          items: { create: [expect.objectContaining({ catalogItemId: 'ci1', quantity: 2, unitPrice: 100 })] },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- quotes.service.spec.ts`
Expected: FAIL — `service.revise is not a function`.

- [ ] **Step 3: Implementar `revise`**

Adicionar a `backend/src/quotes/quotes.service.ts`:

```ts
  async revise(id: string) {
    const quote = await this.mustFind(id);
    if (quote.status !== 'SENT' && quote.status !== 'REJECTED') {
      throw new BadRequestException('Só é possível revisar orçamentos enviados ou rejeitados.');
    }
    const rootId = quote.rootQuoteId ?? quote.id;
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: quote.id }, data: { status: 'SUPERSEDED' } });
      return tx.quote.create({
        data: {
          number: quote.number,
          clientId: quote.clientId,
          ticketId: quote.ticketId,
          categoryId: quote.categoryId,
          title: quote.title,
          status: 'DRAFT',
          version: quote.version + 1,
          rootQuoteId: rootId,
          publicToken: randomBytes(24).toString('hex'),
          validUntil: quote.validUntil,
          notes: quote.notes,
          createdById: quote.createdById,
          items: {
            create: quote.items.map((i) => ({
              catalogItemId: i.catalogItemId,
              description: i.description,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
      });
    });
    return this.findOne(created.id);
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- quotes.service.spec.ts`
Expected: PASS (11 testes no total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/quotes
git commit -m "feat(quotes): revisão gera nova versão e supersede a anterior"
```

---

## Task 12: `TicketsService.createFromQuote`

**Files:**
- Modify: `backend/src/tickets/tickets.service.ts`
- Modify: `backend/src/tickets/tickets.service.spec.ts`

**Interfaces:**
- Produces: `TicketsService.createFromQuote(tx: Prisma.TransactionClient, input: { clientId: string; categoryId: string; title: string }): Promise<Ticket>`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `backend/src/tickets/tickets.service.spec.ts` (reaproveitar o
helper de mock de `tx`/`prisma` já existente no arquivo — ver os testes de
`create()` no topo do arquivo pra montar `prisma`/`tx`/`sla`/`events` do
mesmo jeito):

```ts
describe('TicketsService.createFromQuote', () => {
  it('cria o chamado sem exigir actor, origin QUOTE, needsTriage false', async () => {
    const tx = {
      ticket: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 't-novo', ...data })),
      },
    };
    const prisma = { $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)) };
    const ticketNumber = { next: vi.fn().mockResolvedValue('2026-0099') };
    const sla = { dueAt: vi.fn().mockResolvedValue(new Date('2026-01-05T00:00:00.000Z')) };
    const events = { record: vi.fn() };
    const service = new TicketsService(
      prisma as any,
      ticketNumber as any,
      sla as any,
      events as any,
      {} as any,
      { created: vi.fn() } as any,
      {} as any,
    );
    const ticket = await service.createFromQuote(tx as any, {
      clientId: 'cli1',
      categoryId: 'cat1',
      title: 'Instalação nova',
    });
    expect(ticket.origin).toBe('QUOTE');
    expect(ticket.needsTriage).toBe(false);
    expect(ticket.requesterId).toBeNull();
    expect(events.record).toHaveBeenCalledWith(tx, 't-novo', 'CREATED', {}, undefined);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- tickets.service.spec.ts`
Expected: FAIL — `service.createFromQuote is not a function`.

- [ ] **Step 3: Implementar `createFromQuote`**

Adicionar em `backend/src/tickets/tickets.service.ts`, como método público
da classe `TicketsService` (perto do `create()` existente):

```ts
  /**
   * Cria o chamado gerado pela aprovação de um orçamento avulso — mesmo
   * padrão sem `actor` já usado pelo `ContractPreventiveCron`: sem
   * solicitante humano, `needsTriage: false` (o orçamento já qualificou o
   * pedido), `origin: 'QUOTE'`.
   */
  async createFromQuote(
    tx: Prisma.TransactionClient,
    input: { clientId: string; categoryId: string; title: string },
  ): Promise<Ticket> {
    const slaDueAt = await this.sla.dueAt('MEDIUM', new Date());
    const number = await this.ticketNumber.next(tx);
    const created = await tx.ticket.create({
      data: {
        number,
        title: input.title,
        description: 'Chamado gerado automaticamente a partir de um orçamento aprovado.',
        clientId: input.clientId,
        requesterId: null,
        categoryId: input.categoryId,
        priority: 'MEDIUM',
        status: 'OPEN',
        origin: 'QUOTE',
        needsTriage: false,
        slaDueAt,
      },
    });
    await this.events.record(tx, created.id, 'CREATED', {}, undefined);
    return created;
  }
```

Confirme que `Prisma` e `Ticket` já estão importados como valores/tipos no
topo do arquivo (o `create()` existente já usa `Prisma.TransactionClient`
implicitamente via `this.prisma.$transaction`; se `Prisma` não estiver
importado, adicionar `import type { Prisma, Ticket } from '@prisma/client';`
— `Prisma`/`Ticket` aqui são só tipos, não classes injetadas, então
`import type` é seguro).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- tickets.service.spec.ts`
Expected: PASS, sem regressão nos testes existentes de `create()`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/tickets/tickets.service.ts backend/src/tickets/tickets.service.spec.ts
git commit -m "feat(tickets): createFromQuote para aprovação de orçamento avulso"
```

---

## Task 13: `QuotesService` — approve/reject público + `quotes-public.controller`

**Files:**
- Create: `backend/src/quotes/quotes-public.controller.ts`
- Modify: `backend/src/quotes/quotes.service.ts`
- Modify: `backend/src/quotes/quotes.service.spec.ts`

**Interfaces:**
- Consumes: `TicketsService.createFromQuote` (Task 12).
- Produces: `QuotesService.findByToken(token: string)`,
  `.approve(token: string)`, `.reject(token: string)`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `quotes.service.spec.ts`:

```ts
describe('QuotesService.approve / reject', () => {
  function makeSentByTokenPrisma(overrides: Record<string, unknown> = {}) {
    const tx = {
      quote: { update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data })) },
    };
    return {
      quote: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'q1',
          clientId: 'cli1',
          ticketId: null,
          categoryId: 'cat1',
          title: 'Instalação',
          status: 'SENT',
        }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'q1', ...data })),
      },
      $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
      tx,
      ...overrides,
    };
  }

  it('approve cria o chamado quando o orçamento é avulso', async () => {
    const prisma = makeSentByTokenPrisma();
    const tickets = { createFromQuote: vi.fn().mockResolvedValue({ id: 'novo-ticket' }) };
    const service = new QuotesService(prisma as any, {} as any, tickets as any);
    const result = await service.approve('tok123');
    expect(tickets.createFromQuote).toHaveBeenCalledWith(prisma.tx, {
      clientId: 'cli1',
      categoryId: 'cat1',
      title: 'Instalação',
    });
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date), ticketId: 'novo-ticket' },
    });
    expect(result.status).toBe('APPROVED');
  });

  it('approve não cria chamado quando o orçamento já tem ticketId', async () => {
    const prisma = makeSentByTokenPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({
      id: 'q1', clientId: 'cli1', ticketId: 't-existente', categoryId: null, title: null, status: 'SENT',
    });
    const tickets = { createFromQuote: vi.fn() };
    const service = new QuotesService(prisma as any, {} as any, tickets as any);
    await service.approve('tok123');
    expect(tickets.createFromQuote).not.toHaveBeenCalled();
    expect(prisma.tx.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'APPROVED', approvedAt: expect.any(Date), ticketId: 't-existente' },
    });
  });

  it('approve em token já resolvido é idempotente (409 com status atual)', async () => {
    const prisma = makeSentByTokenPrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'APPROVED' });
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await expect(service.approve('tok123')).rejects.toMatchObject({ status: 409 });
  });

  it('reject marca REJECTED e não mexe em chamado', async () => {
    const prisma = makeSentByTokenPrisma();
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await service.reject('tok123');
    expect(prisma.quote.update).toHaveBeenCalledWith({
      where: { id: 'q1' },
      data: { status: 'REJECTED', rejectedAt: expect.any(Date) },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- quotes.service.spec.ts`
Expected: FAIL — `QuotesService` não aceita um 3º parâmetro / `approve` não existe.

- [ ] **Step 3: Implementar `findByToken`, `approve`, `reject`**

Modificar o construtor de `QuotesService` em
`backend/src/quotes/quotes.service.ts` pra receber `TicketsService` (import
de **valor**, nunca `import type` — é usado como tipo de injeção):

```ts
import { TicketsService } from '../tickets/tickets.service.js';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly quoteNumber: QuoteNumberService,
    private readonly tickets: TicketsService,
  ) {}
```

E adicionar os métodos:

```ts
  async findByToken(token: string) {
    const quote = await this.prisma.quote.findUnique({ where: { publicToken: token }, include: QUOTE_INCLUDE });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');
    return withTotal(quote);
  }

  private async mustFindByToken(token: string) {
    const quote = await this.prisma.quote.findUnique({ where: { publicToken: token } });
    if (!quote) throw new NotFoundException('Orçamento não encontrado.');
    return quote;
  }

  async approve(token: string) {
    const quote = await this.mustFindByToken(token);
    if (quote.status !== 'SENT') {
      throw new ConflictException({ status: quote.status });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      let ticketId = quote.ticketId;
      if (!ticketId) {
        const ticket = await this.tickets.createFromQuote(tx, {
          clientId: quote.clientId,
          categoryId: quote.categoryId!,
          title: quote.title!,
        });
        ticketId = ticket.id;
      }
      return tx.quote.update({
        where: { id: quote.id },
        data: { status: 'APPROVED', approvedAt: new Date(), ticketId },
      });
    });
    return this.findOne(updated.id);
  }

  async reject(token: string) {
    const quote = await this.mustFindByToken(token);
    if (quote.status !== 'SENT') {
      throw new ConflictException({ status: quote.status });
    }
    await this.prisma.quote.update({ where: { id: quote.id }, data: { status: 'REJECTED', rejectedAt: new Date() } });
    return this.findOne(quote.id);
  }
```

Adicionar `ConflictException` ao import de `@nestjs/common` no topo do
arquivo.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- quotes.service.spec.ts`
Expected: PASS (15 testes no total).

- [ ] **Step 5: `quotes-public.controller.ts`**

`backend/src/quotes/quotes-public.controller.ts`:

```ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { QuotesService } from './quotes.service.js';

@Controller('public/quotes')
@Public()
export class QuotesPublicController {
  constructor(private readonly quotes: QuotesService) {}

  @Get(':token')
  find(@Param('token') token: string) {
    return this.quotes.findByToken(token);
  }

  @Post(':token/approve')
  approve(@Param('token') token: string) {
    return this.quotes.approve(token);
  }

  @Post(':token/reject')
  reject(@Param('token') token: string) {
    return this.quotes.reject(token);
  }
}
```

- [ ] **Step 6: Rodar toda a suíte unit de `quotes`**

Run: `npm run test -- quotes`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/quotes
git commit -m "feat(quotes): aprovação/rejeição por link público, idempotente"
```

---

## Task 14: `quotes.controller`/`quotes.module` + registro no `app.module.ts`

**Files:**
- Create: `backend/src/quotes/quotes.controller.ts`
- Create: `backend/src/quotes/quotes.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: todos os métodos de `QuotesService` das Tasks 9–13.
- Produces: rotas HTTP autenticadas de `quotes` + rotas públicas registradas no app.

- [ ] **Step 1: `QuotesController`**

`backend/src/quotes/quotes.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../common/roles.decorator.js';
import { QuotesService } from './quotes.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { UpdateQuoteDto } from './dto/update-quote.dto.js';
import { ListQuotesDto } from './dto/list-quotes.dto.js';

@Controller('quotes')
@Roles('ADMIN', 'AGENT')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  findAll(@Query() query: ListQuotesDto) {
    return this.quotes.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotes.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuoteDto, @Req() req: Request) {
    return this.quotes.create(dto, (req as any).user.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotes.update(id, dto);
  }

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.quotes.send(id);
  }

  @Post(':id/revise')
  revise(@Param('id') id: string) {
    return this.quotes.revise(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quotes.remove(id);
  }
}
```

- [ ] **Step 2: Adicionar `remove` ao `QuotesService`**

O controller acima chama `this.quotes.remove(id)`, que ainda não existe —
adicionar a `backend/src/quotes/quotes.service.ts`:

```ts
  async remove(id: string) {
    const quote = await this.mustFind(id);
    if (quote.status !== 'DRAFT') {
      throw new BadRequestException('Só é possível excluir orçamentos em rascunho.');
    }
    await this.prisma.quote.delete({ where: { id } });
  }
```

- [ ] **Step 3: Teste de `remove`**

Adicionar a `quotes.service.spec.ts`:

```ts
describe('QuotesService.remove', () => {
  it('rejeita excluir fora de DRAFT', async () => {
    const prisma = makePrisma();
    prisma.quote.findUnique = vi.fn().mockResolvedValue({ id: 'q1', status: 'SENT', items: [] });
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await expect(service.remove('q1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('exclui orçamento em DRAFT', async () => {
    const prisma = makePrisma({ quote: { findUnique: vi.fn().mockResolvedValue({ id: 'q1', status: 'DRAFT', items: [] }), delete: vi.fn() } });
    const service = new QuotesService(prisma as any, {} as any, {} as any);
    await service.remove('q1');
    expect(prisma.quote.delete).toHaveBeenCalledWith({ where: { id: 'q1' } });
  });
});
```

Run: `npm run test -- quotes.service.spec.ts`
Expected: PASS (17 testes no total).

- [ ] **Step 4: `QuotesModule`**

`backend/src/quotes/quotes.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesPublicController } from './quotes-public.controller.js';
import { QuotesService } from './quotes.service.js';
import { QuoteNumberService } from './quote-number.service.js';

@Module({
  imports: [CatalogModule, TicketsModule],
  controllers: [QuotesController, QuotesPublicController],
  providers: [QuotesService, QuoteNumberService],
  exports: [QuotesService],
})
export class QuotesModule {}
```

- [ ] **Step 5: Registrar no `app.module.ts`**

```ts
import { QuotesModule } from './quotes/quotes.module.js';
```

```ts
    QuotesModule,
```

- [ ] **Step 6: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 7: Rodar toda a suíte unit**

Run: `npm run test`
Expected: PASS, sem regressão.

- [ ] **Step 8: Commit**

```bash
git add backend/src/quotes backend/src/app.module.ts
git commit -m "feat(quotes): rotas autenticadas e públicas registradas"
```

---

## Task 15: Integração — ciclos completos (Postgres real)

**Files:**
- Create: `backend/src/stock/stock.integration.spec.ts`
- Create: `backend/src/quotes/quotes.integration.spec.ts`

**Interfaces:**
- Consumes: `StockService`, `QuotesService`, `TicketsService` reais (sem
  mock), `PrismaClient` direto.

- [ ] **Step 1: `stock.integration.spec.ts` — ciclo de estoque**

`backend/src/stock/stock.integration.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StockService } from './stock.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Entrada → transferência → requisição
// no chamado → saldo final correto nos dois depósitos. Sobe com
// `docker compose up -d postgres`. Sem banco no ar, pula com aviso.
const PFX = `STK-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticketMaterialUsage.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockTransfer.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockEntry.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.stockBalance.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.warehouse.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Stock — ciclo completo (Postgres real)', () => {
  let stock: StockService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[stock.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);
    stock = new StockService(new PrismaService() as unknown as PrismaService);
    // PrismaService estende PrismaClient — reaproveita a mesma conexão do teste
    Object.assign(stock as any, { prisma });

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const almox = await prisma.warehouse.create({ data: { name: `${PFX} Almoxarifado` } });
    const van = await prisma.warehouse.create({ data: { name: `${PFX} Van` } });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Cabo de rede`, type: 'PRODUCT', unit: 'm', price: 3 },
    });
    const ticket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado de teste',
        description: 'x',
        clientId: client.id,
        priority: 'MEDIUM',
        status: 'IN_PROGRESS',
        origin: 'MANUAL',
      },
    });
    const user = await prisma.user.findFirst();
    id.almox = almox.id;
    id.van = van.id;
    id.item = item.id;
    id.ticket = ticket.id;
    id.user = user!.id;
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('entrada, transferência e requisição deixam o saldo final correto', async () => {
    if (!available) return;

    await stock.createEntry({ catalogItemId: id.item, warehouseId: id.almox, quantity: 100, unitCost: 2 }, id.user);
    await stock.createTransfer({ catalogItemId: id.item, fromWarehouseId: id.almox, toWarehouseId: id.van, quantity: 30 }, id.user);
    await stock.registerMaterialUsage(id.ticket, { catalogItemId: id.item, warehouseId: id.van, quantity: 10 }, id.user);

    const balances = await stock.listBalances({ catalogItemId: id.item });
    const almoxBalance = balances.find((b) => b.warehouseId === id.almox)!;
    const vanBalance = balances.find((b) => b.warehouseId === id.van)!;
    expect(almoxBalance.quantity).toBe(70);
    expect(vanBalance.quantity).toBe(20);
    expect(vanBalance.avgCost).toBe(2);
  });
});
```

> **Nota de execução:** `PrismaService` normalmente é instanciado pelo Nest
> DI e já é ele mesmo um `PrismaClient` estendido — o `Object.assign` acima
> é um atalho só pro teste de integração não precisar montar um
> `Test.createTestingModule` completo; siga o mesmo padrão que
> `contracts.integration.spec.ts` já usa (leia esse arquivo antes de
> escrever este, o mock exato de `PrismaService` pode já resolver isso sem
> o atalho — copie o padrão de lá em vez de inventar um novo).

- [ ] **Step 2: `quotes.integration.spec.ts` — ciclo de orçamento avulso**

`backend/src/quotes/quotes.integration.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotesService } from './quotes.service.js';
import { QuoteNumberService } from './quote-number.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { SlaService } from '../sla/sla.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Criar orçamento avulso → enviar →
// aprovar por token → chamado criado com origin QUOTE e originQuoteId certo.
const PFX = `QT-${Date.now()}`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.quote.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Quotes — aprovação avulsa vira chamado (Postgres real)', () => {
  let quotes: QuotesService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[quotes.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const category = await prisma.category.create({ data: { name: `${PFX} Categoria` } });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Instalação`, type: 'SERVICE', unit: 'un', price: 500 },
    });
    const user = await prisma.user.findFirst();
    id.client = client.id;
    id.category = category.id;
    id.item = item.id;
    id.user = user!.id;

    const prismaService = new PrismaService();
    Object.assign(prismaService as any, prisma);
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const contracts = new ContractsService(prismaService);
    const tickets = new TicketsService(
      prismaService,
      ticketNumber,
      sla,
      events,
      statusRules,
      { created: async () => {}, resolved: async () => {}, assigned: async () => {} } as any,
      contracts,
    );
    quotes = new QuotesService(prismaService, new QuoteNumberService(), tickets);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('orçamento avulso aprovado gera chamado origin QUOTE', async () => {
    if (!available) return;

    const created = await quotes.create(
      {
        clientId: id.client,
        categoryId: id.category,
        title: `${PFX} Instalação nova`,
        items: [{ catalogItemId: id.item, quantity: 1 }],
      },
      id.user,
    );
    await quotes.send(created.id);
    const sent = await quotes.findOne(created.id);
    const approved = await quotes.approve((sent as any).publicToken ?? (await prisma!.quote.findUnique({ where: { id: created.id } }))!.publicToken);

    expect(approved.status).toBe('APPROVED');
    expect(approved.ticketId).toBeTruthy();
    const ticket = await prisma!.ticket.findUnique({ where: { id: approved.ticketId! } });
    expect(ticket?.origin).toBe('QUOTE');
    expect(ticket?.originQuoteId ?? approved.id).toBeTruthy();
  });
});
```

> **Nota de execução:** `findOne`/`QUOTE_INCLUDE` não selecionam
> `publicToken` — se o `sent.publicToken` vier `undefined` no teste, busque
> direto via `prisma.quote.findUnique({ where: { id: created.id } })` (já
> está no fallback acima). Ajuste conforme o comportamento real observado
> ao rodar.

- [ ] **Step 3: Rodar os testes de integração**

Run (com Postgres no ar — `docker compose up -d postgres` na raiz do
repo): `npm run test:integration`
Expected: PASS (ou pulados com aviso se o Postgres não estiver acessível).

- [ ] **Step 4: Commit**

```bash
git add backend/src/stock/stock.integration.spec.ts backend/src/quotes/quotes.integration.spec.ts
git commit -m "test(integration): ciclo completo de estoque e de orçamento avulso"
```

---

## Task 16: CHANGELOG (parcial) — checkpoint de backend

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:** nenhuma (documentação).

- [ ] **Step 1: Adicionar entrada em "Não lançado"**

Em `CHANGELOG.md`, logo abaixo de `## [Não lançado]`:

```markdown
## [Não lançado]

### Adicionado
- **Catálogo** de serviços e produtos (preço, unidade).
- **Estoque** por depósito: saldo, entrada com custo médio, transferência
  entre depósitos, requisição de material amarrada ao chamado, alerta
  visual de estoque mínimo.
- **Orçamento**: itens do catálogo, nasce de um chamado ou avulso,
  versionado (revisão = nova versão), aprovação/rejeição do cliente por
  link público sem login — aprovado vira chamado automaticamente.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog parcial do backend de catálogo/estoque/orçamento"
```

---

## Task 17: Frontend — `lib/catalog.ts` + `/app/catalogo`

**Files:**
- Create: `frontend/src/lib/catalog.ts`
- Create: `frontend/src/app/app/catalogo/page.tsx`
- Modify: `frontend/src/components/nav.tsx`

**Interfaces:**
- Produces: `useCatalogItems(filter)`, `useCreateCatalogItem()`,
  `useUpdateCatalogItem()`, tipo `CatalogItem`, `CatalogItemType`.

- [ ] **Step 1: `lib/catalog.ts`**

`frontend/src/lib/catalog.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type CatalogItemType = 'SERVICE' | 'PRODUCT';

export const CATALOG_ITEM_TYPE_LABELS: Record<CatalogItemType, string> = {
  SERVICE: 'Serviço',
  PRODUCT: 'Produto',
};

export interface CatalogItem {
  id: string;
  name: string;
  type: CatalogItemType;
  unit: string;
  price: number;
  active: boolean;
}

export interface CatalogItemFilters {
  type?: CatalogItemType;
  active?: boolean;
}

function toQuery(f: CatalogItemFilters): string {
  const p = new URLSearchParams();
  if (f.type) p.set('type', f.type);
  if (f.active !== undefined) p.set('active', String(f.active));
  return p.toString();
}

export function useCatalogItems(filter: CatalogItemFilters = {}) {
  return useQuery({
    queryKey: ['catalog-items', filter],
    queryFn: () => api<CatalogItem[]>(`/catalog-items?${toQuery(filter)}`),
  });
}

export interface CatalogItemInput {
  name: string;
  type: CatalogItemType;
  unit: string;
  price: number;
}

export function useCreateCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CatalogItemInput) => api<CatalogItem>('/catalog-items', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-items'] }),
  });
}

export function useUpdateCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CatalogItemInput> & { id: string; active?: boolean }) =>
      api<CatalogItem>(`/catalog-items/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-items'] }),
  });
}
```

- [ ] **Step 2: `/app/catalogo/page.tsx`**

`frontend/src/app/app/catalogo/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import {
  CATALOG_ITEM_TYPE_LABELS,
  useCatalogItems,
  useCreateCatalogItem,
  useUpdateCatalogItem,
  type CatalogItem,
  type CatalogItemType,
} from '@/lib/catalog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function CatalogPage() {
  const [type, setType] = useState<CatalogItemType | ''>('');
  const { data: items, isLoading } = useCatalogItems({ type: type || undefined });
  const [form, setForm] = useState({ name: '', type: 'SERVICE' as CatalogItemType, unit: '', price: '' });
  const create = useCreateCatalogItem();
  const update = useUpdateCatalogItem();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Catálogo</h1>

      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { name: form.name, type: form.type, unit: form.unit, price: Number(form.price) },
            { onSuccess: () => setForm({ name: '', type: 'SERVICE', unit: '', price: '' }) },
          );
        }}
      >
        <Input className="h-9 w-56" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        <Select className="h-9 w-36" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CatalogItemType })}>
          {Object.entries(CATALOG_ITEM_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <Input className="h-9 w-24" placeholder="Unidade" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required />
        <Input className="h-9 w-32" type="number" step="0.01" placeholder="Preço" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required />
        <Button type="submit" className="h-9">Adicionar</Button>
      </form>

      <div className="flex gap-2">
        <Select className="h-9 w-40" value={type} onChange={(e) => setType(e.target.value as CatalogItemType | '')}>
          <option value="">Todos os tipos</option>
          {Object.entries(CATALOG_ITEM_TYPE_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <ul className="flex flex-col gap-1">
        {items?.map((item) => (
          <CatalogItemRow key={item.id} item={item} onToggle={() => update.mutate({ id: item.id, active: !item.active })} />
        ))}
      </ul>
    </div>
  );
}

function CatalogItemRow({ item, onToggle }: { item: CatalogItem; onToggle: () => void }) {
  return (
    <li className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span className="flex items-center gap-2">
        <Badge tone={item.type === 'PRODUCT' ? 'blue' : 'neutral'}>{CATALOG_ITEM_TYPE_LABELS[item.type]}</Badge>
        {item.name}
        <span className="text-muted-foreground">— {item.unit} — R$ {item.price.toFixed(2)}</span>
        {!item.active && <Badge tone="neutral">Inativo</Badge>}
      </span>
      <Button variant="ghost" className="h-8" onClick={onToggle}>
        {item.active ? 'Desativar' : 'Ativar'}
      </Button>
    </li>
  );
}
```

> Confira as props aceitas por `Badge`/`Select`/`Input` em
> `frontend/src/components/ui/*.tsx` antes de copiar isto literalmente —
> ajuste `tone`/`className` pro nome exato de prop que o componente usa
> nesta versão do projeto (o padrão de `tone` já aparece em
> `/app/contratos/page.tsx`, `statusTone`).

- [ ] **Step 3: Nav**

Em `frontend/src/components/nav.tsx`, na função `appLinks`, adicionar
depois de `{ href: '/app/contratos', label: 'Contratos' }`:

```ts
    { href: '/app/catalogo', label: 'Catálogo' },
```

- [ ] **Step 4: Testar no navegador**

Rodar o dev server do frontend, logar como ADMIN, abrir `/app/catalogo`,
cadastrar um item de cada tipo, confirmar filtro por tipo e toggle
ativo/inativo.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/catalog.ts frontend/src/app/app/catalogo frontend/src/components/nav.tsx
git commit -m "feat(frontend): tela de catálogo de serviços e produtos"
```

---

## Task 18: Frontend — `lib/stock.ts` + `/app/estoque`

**Files:**
- Create: `frontend/src/lib/stock.ts`
- Create: `frontend/src/app/app/estoque/page.tsx`
- Modify: `frontend/src/components/nav.tsx`

**Interfaces:**
- Consumes: `useCatalogItems` (Task 17).
- Produces: `useWarehouses()`, `useCreateWarehouse()`, `useStockBalances(filter)`,
  `useUpdateMinQuantity()`, `useCreateStockEntry()`, `useCreateStockTransfer()`.

- [ ] **Step 1: `lib/stock.ts`**

`frontend/src/lib/stock.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface Warehouse {
  id: string;
  name: string;
  active: boolean;
}

export interface StockBalance {
  catalogItemId: string;
  warehouseId: string;
  quantity: number;
  minQuantity: number | null;
  avgCost: number;
  belowMinimum: boolean;
  catalogItem: { id: string; name: string; unit: string };
  warehouse: { id: string; name: string };
}

export function useWarehouses() {
  return useQuery({ queryKey: ['warehouses'], queryFn: () => api<Warehouse[]>('/warehouses') });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Warehouse>('/warehouses', { method: 'POST', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}

export interface StockBalanceFilters {
  warehouseId?: string;
  catalogItemId?: string;
  belowMinimum?: boolean;
}

function toQuery(f: StockBalanceFilters): string {
  const p = new URLSearchParams();
  if (f.warehouseId) p.set('warehouseId', f.warehouseId);
  if (f.catalogItemId) p.set('catalogItemId', f.catalogItemId);
  if (f.belowMinimum) p.set('belowMinimum', 'true');
  return p.toString();
}

export function useStockBalances(filter: StockBalanceFilters = {}) {
  return useQuery({
    queryKey: ['stock-balances', filter],
    queryFn: () => api<StockBalance[]>(`/stock/balances?${toQuery(filter)}`),
  });
}

export function useUpdateMinQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ catalogItemId, warehouseId, minQuantity }: { catalogItemId: string; warehouseId: string; minQuantity: number | null }) =>
      api(`/stock/balances/${catalogItemId}/${warehouseId}`, { method: 'PATCH', body: { minQuantity } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}

export interface StockEntryInput {
  catalogItemId: string;
  warehouseId: string;
  quantity: number;
  unitCost: number;
  notes?: string;
}

export function useCreateStockEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StockEntryInput) => api('/stock/entries', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}

export interface StockTransferInput {
  catalogItemId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  notes?: string;
}

export function useCreateStockTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StockTransferInput) => api('/stock/transfers', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-balances'] }),
  });
}
```

- [ ] **Step 2: `/app/estoque/page.tsx`**

`frontend/src/app/app/estoque/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useCatalogItems } from '@/lib/catalog';
import {
  useCreateStockEntry,
  useCreateStockTransfer,
  useCreateWarehouse,
  useStockBalances,
  useWarehouses,
} from '@/lib/stock';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';

export default function StockPage() {
  const { data: warehouses } = useWarehouses();
  const { data: items } = useCatalogItems({ type: 'PRODUCT' });
  const { data: balances, isLoading } = useStockBalances({});
  const createWarehouse = useCreateWarehouse();
  const createEntry = useCreateStockEntry();
  const createTransfer = useCreateStockTransfer();

  const [newWarehouse, setNewWarehouse] = useState('');
  const [entry, setEntry] = useState({ catalogItemId: '', warehouseId: '', quantity: '', unitCost: '' });
  const [transfer, setTransfer] = useState({ catalogItemId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '' });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Estoque</h1>

      <Tabs.Root defaultValue="saldos">
        <Tabs.List>
          <Tabs.Trigger value="saldos">Saldos</Tabs.Trigger>
          <Tabs.Trigger value="entradas">Entradas</Tabs.Trigger>
          <Tabs.Trigger value="transferencias">Transferências</Tabs.Trigger>
          <Tabs.Trigger value="depositos">Depósitos</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="saldos">
          {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          <ul className="flex flex-col gap-1">
            {balances?.map((b) => (
              <li
                key={`${b.catalogItemId}-${b.warehouseId}`}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${b.belowMinimum ? 'border-amber-400 bg-amber-50' : 'border-border'}`}
              >
                <span>
                  {b.catalogItem.name} — {b.warehouse.name}: <strong>{b.quantity} {b.catalogItem.unit}</strong>
                  {b.minQuantity != null && <span className="text-muted-foreground"> (mín. {b.minQuantity})</span>}
                </span>
                {b.belowMinimum && <Badge tone="amber">Abaixo do mínimo</Badge>}
              </li>
            ))}
          </ul>
        </Tabs.Content>

        <Tabs.Content value="entradas">
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createEntry.mutate({
                catalogItemId: entry.catalogItemId,
                warehouseId: entry.warehouseId,
                quantity: Number(entry.quantity),
                unitCost: Number(entry.unitCost),
              });
            }}
          >
            <Select className="h-9 w-56" value={entry.catalogItemId} onChange={(e) => setEntry({ ...entry, catalogItemId: e.target.value })} required>
              <option value="">Item…</option>
              {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            <Select className="h-9 w-48" value={entry.warehouseId} onChange={(e) => setEntry({ ...entry, warehouseId: e.target.value })} required>
              <option value="">Depósito…</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Input className="h-9 w-28" type="number" step="0.01" placeholder="Quantidade" value={entry.quantity} onChange={(e) => setEntry({ ...entry, quantity: e.target.value })} required />
            <Input className="h-9 w-28" type="number" step="0.01" placeholder="Custo unit." value={entry.unitCost} onChange={(e) => setEntry({ ...entry, unitCost: e.target.value })} required />
            <Button type="submit" className="h-9">Registrar entrada</Button>
          </form>
        </Tabs.Content>

        <Tabs.Content value="transferencias">
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createTransfer.mutate({
                catalogItemId: transfer.catalogItemId,
                fromWarehouseId: transfer.fromWarehouseId,
                toWarehouseId: transfer.toWarehouseId,
                quantity: Number(transfer.quantity),
              });
            }}
          >
            <Select className="h-9 w-56" value={transfer.catalogItemId} onChange={(e) => setTransfer({ ...transfer, catalogItemId: e.target.value })} required>
              <option value="">Item…</option>
              {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
            <Select className="h-9 w-40" value={transfer.fromWarehouseId} onChange={(e) => setTransfer({ ...transfer, fromWarehouseId: e.target.value })} required>
              <option value="">De…</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select className="h-9 w-40" value={transfer.toWarehouseId} onChange={(e) => setTransfer({ ...transfer, toWarehouseId: e.target.value })} required>
              <option value="">Para…</option>
              {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Input className="h-9 w-28" type="number" step="0.01" placeholder="Quantidade" value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: e.target.value })} required />
            <Button type="submit" className="h-9">Transferir</Button>
          </form>
        </Tabs.Content>

        <Tabs.Content value="depositos">
          <form
            className="flex items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              createWarehouse.mutate(newWarehouse, { onSuccess: () => setNewWarehouse('') });
            }}
          >
            <Input className="h-9 w-56" placeholder="Nome do depósito" value={newWarehouse} onChange={(e) => setNewWarehouse(e.target.value)} required />
            <Button type="submit" className="h-9">Novo depósito</Button>
          </form>
          <ul className="mt-3 flex flex-col gap-1">
            {warehouses?.map((w) => (
              <li key={w.id} className="rounded-md border border-border px-3 py-2 text-sm">{w.name}</li>
            ))}
          </ul>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
```

> Confira a API real de `frontend/src/components/ui/tabs.tsx` (nomes
> exportados podem ser `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` em vez
> de `Tabs.Root`/`Tabs.List`/etc. — ajuste os imports/uso pro que o arquivo
> realmente exporta antes de compilar).

- [ ] **Step 3: Nav**

Em `frontend/src/components/nav.tsx`, depois de `/app/catalogo`:

```ts
    { href: '/app/estoque', label: 'Estoque' },
```

- [ ] **Step 4: Testar no navegador**

Cadastrar 2 depósitos, dar entrada num item PRODUCT, transferir entre eles,
setar um `minQuantity` e confirmar o destaque visual quando o saldo fica
abaixo.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/stock.ts frontend/src/app/app/estoque frontend/src/components/nav.tsx
git commit -m "feat(frontend): tela de estoque (saldos, entradas, transferências, depósitos)"
```

---

## Task 19: Frontend — `lib/quotes.ts` + `/app/orcamentos` + página pública

**Files:**
- Create: `frontend/src/lib/quotes.ts`
- Create: `frontend/src/app/app/orcamentos/page.tsx`
- Create: `frontend/src/app/app/orcamentos/novo/page.tsx`
- Create: `frontend/src/app/app/orcamentos/[id]/page.tsx`
- Create: `frontend/src/app/orcamento/[token]/page.tsx`
- Modify: `frontend/src/components/nav.tsx`

**Interfaces:**
- Consumes: `useCatalogItems` (Task 17).
- Produces: `useQuotes(filter)`, `useQuote(id)`, `useCreateQuote()`,
  `useSendQuote()`, `useReviseQuote()`.

- [ ] **Step 1: `lib/quotes.ts`**

`frontend/src/lib/quotes.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  APPROVED: 'Aprovado',
  REJECTED: 'Rejeitado',
  SUPERSEDED: 'Substituído',
};

export interface QuoteItem {
  catalogItemId: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  catalogItem: { id: string; name: string; unit: string };
}

export interface Quote {
  id: string;
  number: number;
  version: number;
  status: QuoteStatus;
  publicToken: string;
  clientId: string;
  client?: { id: string; name: string };
  ticketId: string | null;
  ticket?: { id: string; number: string } | null;
  categoryId: string | null;
  title: string | null;
  notes: string | null;
  items: QuoteItem[];
  total: number;
}

export interface QuoteFilters {
  clientId?: string;
  ticketId?: string;
  status?: QuoteStatus;
}

function toQuery(f: QuoteFilters): string {
  const p = new URLSearchParams();
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.ticketId) p.set('ticketId', f.ticketId);
  if (f.status) p.set('status', f.status);
  return p.toString();
}

export function useQuotes(filter: QuoteFilters = {}) {
  return useQuery({ queryKey: ['quotes', filter], queryFn: () => api<Quote[]>(`/quotes?${toQuery(filter)}`) });
}

export function useQuote(id: string) {
  return useQuery({ queryKey: ['quote', id], queryFn: () => api<Quote>(`/quotes/${id}`), enabled: !!id });
}

export interface QuoteItemInput {
  catalogItemId: string;
  quantity: number;
  unitPrice?: number;
  description?: string;
}

export interface QuoteInput {
  clientId: string;
  ticketId?: string;
  categoryId?: string;
  title?: string;
  notes?: string;
  items: QuoteItemInput[];
}

export function useCreateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: QuoteInput) => api<Quote>('/quotes', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}

export function useSendQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Quote>(`/quotes/${id}/send`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
    },
  });
}

export function useReviseQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Quote>(`/quotes/${id}/revise`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}
```

- [ ] **Step 2: `/app/orcamentos/page.tsx`** (lista)

`frontend/src/app/app/orcamentos/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QUOTE_STATUS_LABELS, useQuotes, type Quote, type QuoteStatus } from '@/lib/quotes';

function statusTone(s: QuoteStatus) {
  if (s === 'APPROVED') return 'green';
  if (s === 'REJECTED' || s === 'SUPERSEDED') return 'neutral';
  if (s === 'SENT') return 'blue';
  return 'amber';
}

export default function QuotesPage() {
  const { data: quotes, isLoading } = useQuotes({});

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Orçamentos</h1>
        <Link href="/app/orcamentos/novo">
          <Button className="h-9">Novo orçamento</Button>
        </Link>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <ul className="flex flex-col gap-1">
        {quotes?.map((q: Quote) => (
          <li key={q.id}>
            <Link
              href={`/app/orcamentos/${q.id}`}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span>
                #{q.number} v{q.version} — {q.client?.name} {q.title ? `— ${q.title}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <span>R$ {q.total.toFixed(2)}</span>
                <Badge tone={statusTone(q.status)}>{QUOTE_STATUS_LABELS[q.status]}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: `/app/orcamentos/novo/page.tsx`**

`frontend/src/app/app/orcamentos/novo/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { useCatalogItems } from '@/lib/catalog';
import { useCreateQuote, type QuoteItemInput } from '@/lib/quotes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export default function NewQuotePage() {
  const router = useRouter();
  const params = useSearchParams();
  const ticketId = params.get('ticketId') ?? undefined;
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => api<{ id: string; name: string }[]>('/categories'),
  });
  const { data: catalogItems } = useCatalogItems({ active: true });
  const create = useCreateQuote();

  const [clientId, setClientId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<QuoteItemInput[]>([{ catalogItemId: '', quantity: 1 }]);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold">Novo orçamento</h1>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            {
              clientId,
              ticketId,
              categoryId: ticketId ? undefined : categoryId,
              title: ticketId ? undefined : title,
              items: items.filter((i) => i.catalogItemId),
            },
            { onSuccess: (q) => router.push(`/app/orcamentos/${q.id}`) },
          );
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Cliente
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)} required>
            <option value="">Selecione…</option>
            {clients?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>

        {!ticketId && (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Categoria (chamado gerado na aprovação)
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">Selecione…</option>
                {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Título do chamado
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
          </>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Itens</span>
          {items.map((item, idx) => (
            <div key={idx} className="flex gap-2">
              <Select
                className="h-9 flex-1"
                value={item.catalogItemId}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], catalogItemId: e.target.value };
                  setItems(next);
                }}
              >
                <option value="">Item…</option>
                {catalogItems?.map((ci) => <option key={ci.id} value={ci.id}>{ci.name} — R$ {ci.price.toFixed(2)}/{ci.unit}</option>)}
              </Select>
              <Input
                className="h-9 w-24"
                type="number"
                step="0.01"
                value={item.quantity}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                  setItems(next);
                }}
              />
            </div>
          ))}
          <Button type="button" variant="ghost" className="h-8 w-fit" onClick={() => setItems([...items, { catalogItemId: '', quantity: 1 }])}>
            + item
          </Button>
        </div>

        <Button type="submit" className="h-9 w-fit">Criar orçamento</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: `/app/orcamentos/[id]/page.tsx`**

`frontend/src/app/app/orcamentos/[id]/page.tsx`:

```tsx
'use client';

import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { QUOTE_STATUS_LABELS, useQuote, useReviseQuote, useSendQuote } from '@/lib/quotes';

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: quote, isLoading } = useQuote(id);
  const send = useSendQuote();
  const revise = useReviseQuote();

  if (isLoading || !quote) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  const publicUrl = `${window.location.origin}/orcamento/${quote.publicToken}`;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">
          Orçamento #{quote.number} v{quote.version}
        </h1>
        <Badge>{QUOTE_STATUS_LABELS[quote.status]}</Badge>
      </div>

      <ul className="flex flex-col gap-1">
        {quote.items.map((item, idx) => (
          <li key={idx} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span>{item.catalogItem.name} × {item.quantity}</span>
            <span>R$ {(item.quantity * item.unitPrice).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="text-right text-sm font-semibold">Total: R$ {quote.total.toFixed(2)}</div>

      {quote.status === 'DRAFT' && (
        <Button className="h-9 w-fit" onClick={() => send.mutate(quote.id)}>Enviar</Button>
      )}
      {(quote.status === 'SENT' || quote.status === 'REJECTED') && (
        <div className="flex items-center gap-2">
          <Input readOnly value={publicUrl} className="h-9" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="ghost" className="h-9" onClick={() => revise.mutate(quote.id)}>Revisar</Button>
        </div>
      )}
    </div>
  );
}
```

Adicionar `import { Input } from '@/components/ui/input';` ao topo (usado
no bloco de link público).

- [ ] **Step 5: página pública `/orcamento/[token]/page.tsx`**

`frontend/src/app/orcamento/[token]/page.tsx` (fora de `/app` — sem layout
de sessão, sem `useSession`):

```tsx
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface PublicQuote {
  number: number;
  status: string;
  items: { quantity: number; unitPrice: number; catalogItem: { name: string; unit: string } }[];
  total: number;
}

export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [actionResult, setActionResult] = useState<string | null>(null);
  const { data: quote, isLoading, refetch } = useQuery({
    queryKey: ['public-quote', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/quotes/${token}`);
      if (!res.ok) throw new Error('Orçamento não encontrado.');
      return (await res.json()) as PublicQuote;
    },
  });

  async function act(action: 'approve' | 'reject') {
    const res = await fetch(`${API_BASE}/public/quotes/${token}/${action}`, { method: 'POST' });
    if (res.status === 409) {
      setActionResult('Este orçamento já foi respondido.');
    } else if (res.ok) {
      setActionResult(action === 'approve' ? 'Orçamento aprovado! Entraremos em contato.' : 'Orçamento rejeitado.');
    }
    refetch();
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!quote) return <p className="p-6 text-sm text-muted-foreground">Orçamento não encontrado.</p>;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Orçamento #{quote.number}</h1>
      <ul className="flex flex-col gap-1">
        {quote.items.map((item, idx) => (
          <li key={idx} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
            <span>{item.catalogItem.name} × {item.quantity} {item.catalogItem.unit}</span>
            <span>R$ {(item.quantity * item.unitPrice).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <div className="text-right text-sm font-semibold">Total: R$ {quote.total.toFixed(2)}</div>

      {actionResult && <p className="text-sm">{actionResult}</p>}
      {!actionResult && quote.status === 'SENT' && (
        <div className="flex gap-2">
          <button className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground" onClick={() => act('approve')}>
            Aprovar
          </button>
          <button className="h-9 rounded-md border border-border px-4 text-sm" onClick={() => act('reject')}>
            Rejeitar
          </button>
        </div>
      )}
      {!actionResult && quote.status !== 'SENT' && (
        <p className="text-sm text-muted-foreground">Este orçamento já foi respondido.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Nav**

Em `frontend/src/components/nav.tsx`, depois de `/app/estoque`:

```ts
    { href: '/app/orcamentos', label: 'Orçamentos' },
```

- [ ] **Step 7: Testar no navegador**

Criar orçamento avulso → enviar → abrir o link público numa aba anônima →
aprovar → conferir que o chamado aparece na fila com origem "Orçamento".

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/quotes.ts frontend/src/app/app/orcamentos frontend/src/app/orcamento frontend/src/components/nav.tsx
git commit -m "feat(frontend): telas de orçamento e página pública de aprovação"
```

---

## Task 20: Frontend — seções no chamado (Materiais usados / Orçamentos)

**Files:**
- Create: `frontend/src/components/ticket-material-usages.tsx`
- Create: `frontend/src/components/ticket-quotes.tsx`
- Modify: `frontend/src/app/app/chamados/[id]/page.tsx` (ou onde o detalhe
  do chamado monta suas seções — confira o caminho real, pode ser
  `frontend/src/app/app/tickets/[id]/page.tsx`)

**Interfaces:**
- Consumes: `GET/POST /tickets/:id/material-usages`, `GET /quotes?ticketId=`.

- [ ] **Step 1: `ticket-material-usages.tsx`**

`frontend/src/components/ticket-material-usages.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useCatalogItems } from '@/lib/catalog';
import { useWarehouses } from '@/lib/stock';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface MaterialUsage {
  id: string;
  quantity: number;
  unitCost: number;
  catalogItem: { name: string; unit: string };
  warehouse: { name: string };
}

export function TicketMaterialUsages({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const { data: usages } = useQuery({
    queryKey: ['ticket-material-usages', ticketId],
    queryFn: () => api<MaterialUsage[]>(`/tickets/${ticketId}/material-usages`),
  });
  const { data: items } = useCatalogItems({ type: 'PRODUCT', active: true });
  const { data: warehouses } = useWarehouses();
  const register = useMutation({
    mutationFn: (input: { catalogItemId: string; warehouseId: string; quantity: number }) =>
      api(`/tickets/${ticketId}/material-usages`, { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket-material-usages', ticketId] }),
  });

  const [form, setForm] = useState({ catalogItemId: '', warehouseId: '', quantity: '' });

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Materiais usados</h3>
      <ul className="flex flex-col gap-1">
        {usages?.map((u) => (
          <li key={u.id} className="flex justify-between rounded-md border border-border px-3 py-1.5 text-sm">
            <span>{u.catalogItem.name} × {u.quantity} {u.catalogItem.unit} ({u.warehouse.name})</span>
            <span className="text-muted-foreground">R$ {(u.quantity * u.unitCost).toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate(
            { catalogItemId: form.catalogItemId, warehouseId: form.warehouseId, quantity: Number(form.quantity) },
            { onSuccess: () => setForm({ catalogItemId: '', warehouseId: '', quantity: '' }) },
          );
        }}
      >
        <Select className="h-9 flex-1" value={form.catalogItemId} onChange={(e) => setForm({ ...form, catalogItemId: e.target.value })} required>
          <option value="">Item…</option>
          {items?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        <Select className="h-9 w-40" value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} required>
          <option value="">Depósito…</option>
          {warehouses?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <Input className="h-9 w-24" type="number" step="0.01" placeholder="Qtd." value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        <Button type="submit" className="h-9">Registrar</Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: `ticket-quotes.tsx`**

`frontend/src/components/ticket-quotes.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { QUOTE_STATUS_LABELS, useQuotes } from '@/lib/quotes';

export function TicketQuotes({ ticketId }: { ticketId: string }) {
  const { data: quotes } = useQuotes({ ticketId });
  if (!quotes?.length) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Orçamentos</h3>
      <ul className="flex flex-col gap-1">
        {quotes.map((q) => (
          <li key={q.id}>
            <Link href={`/app/orcamentos/${q.id}`} className="flex justify-between rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent">
              <span>#{q.number} v{q.version}</span>
              <span>{QUOTE_STATUS_LABELS[q.status]} — R$ {q.total.toFixed(2)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Registrar as duas seções na ficha do chamado**

Localizar o arquivo real do detalhe do chamado (`Glob` por
`frontend/src/app/app/**/chamado*/[id]/page.tsx` ou `tickets*/[id]/page.tsx`
— o nome exato depende da estrutura já existente) e importar/renderizar:

```tsx
import { TicketMaterialUsages } from '@/components/ticket-material-usages';
import { TicketQuotes } from '@/components/ticket-quotes';
```

```tsx
<TicketMaterialUsages ticketId={ticket.id} />
<TicketQuotes ticketId={ticket.id} />
```

Posicionar essas duas seções junto das demais seções do detalhe (perto de
"Visitas"/anexos), seguindo o layout já existente na página.

- [ ] **Step 4: Testar no navegador**

Abrir um chamado, registrar material usado, confirmar baixa no
`/app/estoque`; criar um orçamento com `ticketId` desse chamado e confirmar
que aparece na seção "Orçamentos" do chamado.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ticket-material-usages.tsx frontend/src/components/ticket-quotes.tsx
git add frontend/src/app/app
git commit -m "feat(frontend): seções de materiais usados e orçamentos no chamado"
```

---

## Task 21: E2E Playwright — orçamento avulso aprovado por link vira chamado

**Files:**
- Create: `frontend/e2e/orcamento-avulso-aprovado.spec.ts`
- Modify: `frontend/e2e/seed-e2e.ts` (se precisar de uma categoria/cliente
  extra — reaproveitar `E2E_CLIENT_ID`/categoria já semeada quando possível)

**Interfaces:** nenhuma nova — usa a UI ponta a ponta.

- [ ] **Step 1: Escrever o teste**

`frontend/e2e/orcamento-avulso-aprovado.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e.js';

test('orçamento avulso aprovado pelo link público vira chamado', async ({ page, context }) => {
  await page.goto('/app/login');
  await page.getByLabel('E-mail').fill(E2E_ADMIN_EMAIL);
  await page.getByLabel('Senha').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL('/app');

  // Cadastro mínimo: item de catálogo
  await page.goto('/app/catalogo');
  await page.getByPlaceholder('Nome').fill('Instalação E2E');
  await page.getByPlaceholder('Unidade').fill('un');
  await page.getByPlaceholder('Preço').fill('500');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByText('Instalação E2E')).toBeVisible();

  // Orçamento avulso
  await page.goto('/app/orcamentos/novo');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E' });
  await page.getByLabel('Categoria (chamado gerado na aprovação)').selectOption({ index: 1 });
  await page.getByLabel('Título do chamado').fill('Instalação nova E2E');
  await page.locator('select').last().selectOption({ label: /Instalação E2E/ });
  await page.getByRole('button', { name: 'Criar orçamento' }).click();
  await expect(page).toHaveURL(/\/app\/orcamentos\/.+/);

  await page.getByRole('button', { name: 'Enviar' }).click();
  const publicLink = await page.getByRole('textbox').inputValue();
  expect(publicLink).toContain('/orcamento/');

  const publicPage = await context.newPage();
  await publicPage.goto(publicLink);
  await publicPage.getByRole('button', { name: 'Aprovar' }).click();
  await expect(publicPage.getByText('Orçamento aprovado')).toBeVisible();

  await page.goto('/app');
  await expect(page.getByText('Instalação nova E2E')).toBeVisible();
});
```

> Os seletores exatos (`getByLabel`, `getByPlaceholder`) dependem dos
> `label`/`placeholder` reais renderizados pelos componentes `Input`/
> `Select` das Tasks 17–19 — rode o teste, veja o que falha e ajuste os
> seletores pro texto/atributo que a página realmente expõe (mesmo
> processo usado nos E2E das fases anteriores).

- [ ] **Step 2: Rodar o E2E**

Run: `npx playwright test orcamento-avulso-aprovado`
Expected: PASS (ajustando seletores conforme necessário no processo acima).

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/orcamento-avulso-aprovado.spec.ts
git commit -m "test(e2e): orçamento avulso aprovado por link vira chamado"
```

---

## Task 22: CHANGELOG final e versão 0.6.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Interfaces:** nenhuma (release).

- [ ] **Step 1: Consolidar o CHANGELOG**

Substituir a entrada parcial da Task 16 por:

```markdown
## [Não lançado]

## [0.6.0] - <DATA_DO_RELEASE>

### Adicionado
- **Catálogo** de serviços e produtos (preço, unidade).
- **Estoque** por depósito (inclusive "van do técnico"): saldo, entrada com
  custo unitário e custo médio ponderado, transferência atômica entre
  depósitos, requisição de material amarrada ao chamado (baixa direta, sem
  aprovação), alerta visual de estoque mínimo.
- **Orçamento**: itens do catálogo (serviço + material), nasce de um
  chamado existente ou avulso, versionado (revisão = nova versão ligada à
  proposta original), aprovação/rejeição do cliente por link público sem
  login — aprovado (e avulso) vira chamado automaticamente.
```

Substituir `<DATA_DO_RELEASE>` pela data real do dia do release.

- [ ] **Step 2: Bump de versão**

Em `backend/package.json` e `frontend/package.json`, `"version"` de
`0.5.0` para `0.6.0`.

- [ ] **Step 3: Rodar a suíte completa**

Run: `cd backend && npm run test && npm run build`
Run: `cd frontend && npm run build`
Expected: tudo verde, build limpo dos dois lados.

- [ ] **Step 4: Commit e tag**

```bash
git add CHANGELOG.md backend/package.json frontend/package.json
git commit -m "chore: release 0.6.0 — catálogo, orçamento e estoque"
git tag v0.6.0
```

---

## Notas de execução

- Este plano assume execução direta na `main` em `os-exec` (sem worktree),
  seguindo o mesmo padrão já usado nas fases 0.2.0–0.5.0 — confirme com o
  usuário antes de começar, como de costume.
- A Task 19, Step 4 (`categories`) assume uma rota `GET /categories` já
  existente retornando um array simples — confirme o formato real (pode
  vir paginado como `/clients`) e ajuste o hook antes de usar.
- Onde este plano diz "confira o arquivo real antes de copiar" (Tasks 7,
  18, 20), é porque o nome exato de um componente/rota já existente não foi
  verificado byte a byte nesta sessão — o executor deve ler o arquivo
  citado primeiro e ajustar a chamada pro que ele realmente exporta, sem
  inventar uma API nova onde já existe uma.
