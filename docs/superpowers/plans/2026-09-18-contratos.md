# Contratos de Manutenção Recorrente (Fase 0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cliente um contrato de manutenção (vigência, valor, escopo de Locais/Ativos, franquia mensal, SLA próprio opcional); chamados no escopo se vinculam sozinhos ao contrato; chamados preventivos nascem automaticamente no calendário do contrato.

**Architecture:** Módulo NestJS novo `contracts` (CRUD + resolução de vínculo + cálculo de consumo, tudo em cima de `PrismaService`, sem depender de outros módulos de domínio). `TicketsService.create`/`setTicketAssets` chamam `ContractsService.resolveForTicket` no mesmo ponto onde já validam Local/Ativos (desde a 0.3.0) pra preencher `Ticket.contractId` sozinho. `SlaService.dueAt` ganha um `contractId?` opcional que checa `ContractSlaPolicy` antes do `SlaPolicy` global. Dois crons novos (`ContractPreventiveCron`, `ContractExpiryCron`) seguem o padrão já existente do `SlaBreachCron`. Frontend: `/app/contratos` (lista + ficha), aba no cliente, badge no chamado.

**Tech Stack:** NestJS (ESM, imports `.js`), Prisma 6 + Postgres, class-validator, `@nestjs/schedule` (já em uso), Vitest (unit + integração com Postgres real), Next.js App Router + React Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-18-contratos-design.md`

## Global Constraints

- **Base:** `main` @ `3853365` (spec da fase commitado; release 0.4.0 já lançada).
- **Execução em disco local:** rodar `npm`/`prisma`/testes em `C:/Users/renan/os-exec` (clone com `origin = github.com/onedayinfo/OS`). `Z:/Projetos/OS` é a working copy do usuário, mantida por push→pull-ff.
- **Imports ESM:** todo import relativo termina em `.js` (ex.: `./contracts.service.js`), mesmo apontando pra `.ts`.
- **DI do Nest por tipo exige import de valor, nunca `import type`** pra uma classe usada só como tipo de parâmetro de construtor — lição da fase 0.4.0 (`import type` apaga a referência de runtime que o Nest usa pra resolver a injeção; só apareceu ao subir o backend de verdade, não nos testes unitários com mock manual).
- **Papéis:** leitura de contratos (`GET`) `ADMIN`,`AGENT`; escrita (`POST`/`PATCH`/cancelar) só `ADMIN`. Sem `@Roles` = qualquer autenticado.
- **Vitest globals:** `describe/it/expect/vi` sem import.
- **Testes de integração:** padrão do repo — `new PrismaClient()`, pula com `console.warn` + exit 0 se `!process.env.DATABASE_URL` ou conexão falhar; prefixo único + `cleanup()` em `beforeAll`/`afterAll`. Script `npm run test:integration`.
- **Conventional Commits** + `CHANGELOG.md` na seção `[Não lançado]` durante o desenvolvimento. Release final = **0.5.0** (MINOR). Nenhuma env nova.
- **Sem faturamento/cobrança, sem aprovação de excedente por orçamento, sem renovação automática** nesta fase (spec §1).

---

## Task 1: Schema Prisma — `Contract`, `ContractSlaPolicy`, migração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_contracts/migration.sql` (gerada)

**Interfaces:**
- Produces: enums `ContractStatus`, `FranchiseUnit`; modelos `Contract`, `ContractSlaPolicy`; `Ticket.contractId String?` + relação `contract`; `TicketOrigin` += `CONTRACT`; `Client.contracts`, `Location.contracts`, `Asset.contracts`, `Category.contracts` (relações reversas).

- [ ] **Step 1: Editar `schema.prisma` — `TicketOrigin`**

```prisma
enum TicketOrigin {
  EMAIL
  PORTAL
  MANUAL
  CONTRACT
}
```

- [ ] **Step 2: Editar `schema.prisma` — enums novos**

Depois do enum `AttachmentKind`, adicionar:

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
```

- [ ] **Step 3: Editar `schema.prisma` — `Client`, `Location`, `Asset`, `Category` ganham a relação reversa**

No `model Client`, depois de `assets Asset[]`:

```prisma
  contracts Contract[]
```

No `model Location`, depois de `tickets Ticket[]`:

```prisma
  contracts Contract[]
```

No `model Asset`, depois de `attachments Attachment[]` (sem nome de relação
explícito — ao contrário de `Asset.tickets` `@relation("TicketAssets")`, só
existe uma relação N:N entre `Asset` e `Contract`, então o Prisma não precisa
de ajuda pra desambiguar):

```prisma
  contracts Contract[]
```

No `model Category`, depois de `checklistTemplate ChecklistTemplate?`:

```prisma
  contracts Contract[]
```

- [ ] **Step 4: Editar `schema.prisma` — modelos novos**

Adicionar depois do `model VisitChecklistAnswer` (antes do `model Location`):

```prisma
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

- [ ] **Step 5: Editar `schema.prisma` — `Ticket`**

Adicionar o campo (perto de `locationId`):

```prisma
  contractId      String?
```

E a relação (perto de `location`):

```prisma
  contract      Contract?       @relation(fields: [contractId], references: [id])
```

E o índice:

```prisma
  @@index([contractId])
```

- [ ] **Step 6: Validar e gerar a migração**

Rodar em `C:/Users/renan/os-exec/backend`:

```bash
npx prisma validate
npx prisma migrate dev --name add_contracts
npx prisma generate
```

Expected: migração criada e aplicada sem erro; client regenerado com
`Contract`, `ContractSlaPolicy`, `ContractStatus`, `FranchiseUnit`.

- [ ] **Step 7: Build de sanidade**

Run: `npm run build`
Expected: `nest build` compila sem erro de tipo.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(contracts): schema de contratos e SLA por contrato"
```

---

## Task 2: Módulo `contracts` — CRUD

**Files:**
- Create: `backend/src/contracts/contracts.module.ts`
- Create: `backend/src/contracts/contracts.service.ts`
- Create: `backend/src/contracts/contracts.controller.ts`
- Create: `backend/src/contracts/dto/contract-sla-item.dto.ts`
- Create: `backend/src/contracts/dto/create-contract.dto.ts`
- Create: `backend/src/contracts/dto/update-contract.dto.ts`
- Create: `backend/src/contracts/dto/list-contracts.dto.ts`
- Create: `backend/src/contracts/contracts.service.spec.ts`
- Modify: `backend/src/app.module.ts` (registrar `ContractsModule`)

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `ContractsService` com `create(dto)`, `update(id,dto)`, `cancel(id)`, `findAll(filter)`, `findOne(id)` — todos retornando o contrato com `consumption` calculado (Task 4 completa esse método; até lá, `consumption` é um stub que devolve zero). `resolveForTicket` e o cálculo real de consumo chegam nas Tasks 3/4.

- [ ] **Step 1: DTOs**

`backend/src/contracts/dto/contract-sla-item.dto.ts`:

```ts
import { IsIn, IsInt, Min } from 'class-validator';
import type { TicketPriority } from '@prisma/client';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export class ContractSlaItemInput {
  @IsIn(PRIORITIES) priority!: TicketPriority;
  @IsInt() @Min(1) hours!: number;
}
```

`backend/src/contracts/dto/create-contract.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ContractSlaItemInput } from './contract-sla-item.dto.js';

export class CreateContractDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsString() @MinLength(1) name!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsOptional() @IsNumber() monthlyValue?: number;
  @IsIn(['VISITS', 'HOURS']) franchiseUnit!: 'VISITS' | 'HOURS';
  @IsInt() @Min(1) franchiseAmount!: number;
  @IsOptional() @IsInt() @Min(1) preventiveFrequencyMonths?: number;
  @IsOptional() @IsString() defaultCategoryId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) locationIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) assetIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractSlaItemInput)
  slaOverrides?: ContractSlaItemInput[];
}
```

`backend/src/contracts/dto/update-contract.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsArray,
  IsISO8601,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ContractSlaItemInput } from './contract-sla-item.dto.js';
import { ValidateNested } from 'class-validator';

export class UpdateContractDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsNumber() monthlyValue?: number;
  @IsOptional() @IsIn(['VISITS', 'HOURS']) franchiseUnit?: 'VISITS' | 'HOURS';
  @IsOptional() @IsInt() @Min(1) franchiseAmount?: number;
  @IsOptional() @IsInt() @Min(1) preventiveFrequencyMonths?: number;
  @IsOptional() @IsString() defaultCategoryId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) locationIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) assetIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContractSlaItemInput)
  slaOverrides?: ContractSlaItemInput[];
}
```

`backend/src/contracts/dto/list-contracts.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

export class ListContractsDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'EXPIRED', 'CANCELLED']) status?: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}
```

- [ ] **Step 2: Escrever o teste que falha**

`backend/src/contracts/contracts.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    location: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    contract: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
      findUnique: vi.fn().mockResolvedValue({ id: 'c1', clientId: 'cli1', startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), franchiseUnit: 'VISITS', franchiseAmount: 4 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
    },
    contractSlaPolicy: { deleteMany: vi.fn(), createMany: vi.fn() },
    ticket: { count: vi.fn().mockResolvedValue(0) },
    visit: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('ContractsService.create', () => {
  it('rejeita endDate <= startDate', async () => {
    const service = new ContractsService(makePrisma() as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-06-01T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita franchiseAmount <= 0', async () => {
    const service = new ContractsService(makePrisma() as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita local de outro cliente no escopo', async () => {
    const prisma = makePrisma({
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'loc1', clientId: 'outro-cliente' }]) },
    });
    const service = new ContractsService(prisma as any);
    await expect(
      service.create({
        clientId: 'cli1',
        name: 'X',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        franchiseUnit: 'VISITS',
        franchiseAmount: 4,
        locationIds: ['loc1'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria com escopo válido', async () => {
    const prisma = makePrisma({
      location: { findMany: vi.fn().mockResolvedValue([{ id: 'loc1', clientId: 'cli1' }]) },
    });
    const service = new ContractsService(prisma as any);
    await service.create({
      clientId: 'cli1',
      name: 'Contrato X',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
      franchiseUnit: 'VISITS',
      franchiseAmount: 4,
      locationIds: ['loc1'],
    });
    expect(prisma.contract.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientId: 'cli1', name: 'Contrato X' }),
      }),
    );
  });
});

describe('ContractsService.update / cancel', () => {
  it('update: 404 se não existir', async () => {
    const prisma = makePrisma({ contract: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new ContractsService(prisma as any);
    await expect(service.update('nope', { name: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update: editar endDate limpa renewalWarnedAt', async () => {
    const service = new ContractsService(makePrisma() as any);
    await service.update('c1', { endDate: '2027-01-01T00:00:00.000Z' });
    const prisma = (service as unknown as { prisma: ReturnType<typeof makePrisma> }).prisma;
    expect(prisma.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ renewalWarnedAt: null }),
      }),
    );
  });

  it('cancel: muda status pra CANCELLED', async () => {
    const service = new ContractsService(makePrisma() as any);
    await service.cancel('c1');
    const prisma = (service as unknown as { prisma: ReturnType<typeof makePrisma> }).prisma;
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { status: 'CANCELLED' },
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: FAIL — `./contracts.service.js` não existe.

- [ ] **Step 4: `contracts.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ContractStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { ListContractsDto } from './dto/list-contracts.dto.js';

const CONTRACT_INCLUDE = {
  client: { select: { id: true, name: true } },
  locations: { select: { id: true, name: true } },
  assets: { select: { id: true, label: true } },
  slaOverrides: true,
} as const;

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertScope(clientId: string, locationIds: string[], assetIds: string[]): Promise<void> {
    if (locationIds.length) {
      const locations = await this.prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, clientId: true },
      });
      if (locations.length !== locationIds.length) {
        throw new BadRequestException('Um ou mais locais não existem.');
      }
      if (locations.some((l) => l.clientId !== clientId)) {
        throw new BadRequestException('Um ou mais locais não pertencem ao cliente.');
      }
    }
    if (assetIds.length) {
      const assets = await this.prisma.asset.findMany({
        where: { id: { in: assetIds } },
        select: { id: true, clientId: true },
      });
      if (assets.length !== assetIds.length) {
        throw new BadRequestException('Um ou mais ativos não existem.');
      }
      if (assets.some((a) => a.clientId !== clientId)) {
        throw new BadRequestException('Um ou mais ativos não pertencem ao cliente.');
      }
    }
  }

  async create(dto: CreateContractDto) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) throw new BadRequestException('endDate precisa ser depois de startDate.');
    if (dto.franchiseAmount <= 0) throw new BadRequestException('franchiseAmount precisa ser maior que zero.');

    const locationIds = dto.locationIds ?? [];
    const assetIds = dto.assetIds ?? [];
    await this.assertScope(dto.clientId, locationIds, assetIds);

    const created = await this.prisma.contract.create({
      data: {
        clientId: dto.clientId,
        name: dto.name,
        startDate: start,
        endDate: end,
        monthlyValue: dto.monthlyValue ?? null,
        franchiseUnit: dto.franchiseUnit,
        franchiseAmount: dto.franchiseAmount,
        preventiveFrequencyMonths: dto.preventiveFrequencyMonths ?? null,
        nextGenerationAt: dto.preventiveFrequencyMonths ? start : null,
        defaultCategoryId: dto.defaultCategoryId ?? null,
        notes: dto.notes ?? null,
        locations: locationIds.length ? { connect: locationIds.map((id) => ({ id })) } : undefined,
        assets: assetIds.length ? { connect: assetIds.map((id) => ({ id })) } : undefined,
        slaOverrides: dto.slaOverrides?.length
          ? { create: dto.slaOverrides.map((s) => ({ priority: s.priority, hours: s.hours })) }
          : undefined,
      },
    });
    return this.findOne(created.id);
  }

  private async mustFind(id: string) {
    const contract = await this.prisma.contract.findUnique({ where: { id } });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return contract;
  }

  async update(id: string, dto: UpdateContractDto) {
    const current = await this.mustFind(id);
    const start = dto.startDate ? new Date(dto.startDate) : current.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : current.endDate;
    if (end <= start) throw new BadRequestException('endDate precisa ser depois de startDate.');
    if (dto.franchiseAmount !== undefined && dto.franchiseAmount <= 0) {
      throw new BadRequestException('franchiseAmount precisa ser maior que zero.');
    }
    if (dto.locationIds !== undefined || dto.assetIds !== undefined) {
      await this.assertScope(current.clientId, dto.locationIds ?? [], dto.assetIds ?? []);
    }

    const data: Prisma.ContractUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startDate !== undefined) data.startDate = start;
    if (dto.endDate !== undefined) {
      data.endDate = end;
      // Editar a vigência sempre libera um novo aviso de vencimento (spec §4.5/§5).
      data.renewalWarnedAt = null;
    }
    if (dto.monthlyValue !== undefined) data.monthlyValue = dto.monthlyValue;
    if (dto.franchiseUnit !== undefined) data.franchiseUnit = dto.franchiseUnit;
    if (dto.franchiseAmount !== undefined) data.franchiseAmount = dto.franchiseAmount;
    if (dto.preventiveFrequencyMonths !== undefined) {
      data.preventiveFrequencyMonths = dto.preventiveFrequencyMonths;
    }
    if (dto.defaultCategoryId !== undefined) data.defaultCategoryId = dto.defaultCategoryId || null;
    if (dto.notes !== undefined) data.notes = dto.notes;

    await this.prisma.contract.update({ where: { id }, data });

    if (dto.locationIds !== undefined) {
      await this.prisma.contract.update({
        where: { id },
        data: { locations: { set: dto.locationIds.map((lid) => ({ id: lid })) } },
      });
    }
    if (dto.assetIds !== undefined) {
      await this.prisma.contract.update({
        where: { id },
        data: { assets: { set: dto.assetIds.map((aid) => ({ id: aid })) } },
      });
    }
    if (dto.slaOverrides !== undefined) {
      await this.prisma.contractSlaPolicy.deleteMany({ where: { contractId: id } });
      if (dto.slaOverrides.length) {
        await this.prisma.contractSlaPolicy.createMany({
          data: dto.slaOverrides.map((s) => ({ contractId: id, priority: s.priority, hours: s.hours })),
        });
      }
    }

    return this.findOne(id);
  }

  async cancel(id: string) {
    await this.mustFind(id);
    await this.prisma.contract.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.findOne(id);
  }

  async findAll(filter: ListContractsDto) {
    const where: Prisma.ContractWhereInput = {};
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.status) where.status = filter.status as ContractStatus;
    const contracts = await this.prisma.contract.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: CONTRACT_INCLUDE,
    });
    return Promise.all(contracts.map(async (c) => ({ ...c, consumption: await this.consumption(c.id) })));
  }

  async findOne(id: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id },
      include: CONTRACT_INCLUDE,
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');
    return { ...contract, consumption: await this.consumption(id) };
  }

  /** Placeholder até a Task 4 — devolve zero. */
  async consumption(_contractId: string): Promise<{ unit: string; used: number; franchiseAmount: number; exceeded: boolean }> {
    return { unit: 'VISITS', used: 0, franchiseAmount: 0, exceeded: false };
  }

  /** Placeholder até a Task 3. */
  async resolveForTicket(
    _clientId: string | null,
    _locationId: string | null,
    _assetIds: string[],
  ): Promise<string | null> {
    return null;
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: `contracts.controller.ts`**

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { ListContractsDto } from './dto/list-contracts.dto.js';

@Controller('contracts')
@Roles('ADMIN', 'AGENT')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  findAll(@Query() query: ListContractsDto) {
    return this.contracts.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contracts.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateContractDto) {
    return this.contracts.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(id, dto);
  }

  @Post(':id/cancel')
  @Roles('ADMIN')
  cancel(@Param('id') id: string) {
    return this.contracts.cancel(id);
  }
}
```

- [ ] **Step 7: `contracts.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ContractsService } from './contracts.service.js';
import { ContractsController } from './contracts.controller.js';

@Module({
  providers: [ContractsService],
  controllers: [ContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
```

- [ ] **Step 8: Registrar no `app.module.ts`**

```ts
import { ContractsModule } from './contracts/contracts.module.js';
```
```ts
    ContractsModule,
```

- [ ] **Step 9: Build + testes**

Run: `npm run build && npx vitest run src/contracts`
Expected: ambos verdes.

- [ ] **Step 10: Commit**

```bash
git add backend/src/contracts backend/src/app.module.ts
git commit -m "feat(contracts): CRUD de contratos com escopo de locais/ativos"
```

---

## Task 3: `ContractsService.resolveForTicket`

**Files:**
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`

**Interfaces:**
- Produces: `ContractsService.resolveForTicket(clientId, locationId, assetIds): Promise<string | null>` — consumido pela Task 6.

- [ ] **Step 1: Adicionar os testes que falham**

```ts
describe('ContractsService.resolveForTicket', () => {
  it('sem clientId ou sem local/ativos → null', async () => {
    const service = new ContractsService(makePrisma() as any);
    expect(await service.resolveForTicket(null, 'loc1', [])).toBeNull();
    expect(await service.resolveForTicket('cli1', null, [])).toBeNull();
  });

  it('resolve pelo local coberto por um contrato ativo', async () => {
    const prisma = makePrisma({
      contract: {
        findFirst: vi.fn().mockResolvedValue({ id: 'c1' }),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    });
    const service = new ContractsService(prisma as any);
    const id = await service.resolveForTicket('cli1', 'loc1', []);
    expect(id).toBe('c1');
    expect(prisma.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clientId: 'cli1', status: 'ACTIVE' }),
        orderBy: { startDate: 'desc' },
      }),
    );
  });

  it('sem contrato cobrindo → null', async () => {
    const prisma = makePrisma({ contract: { findFirst: vi.fn().mockResolvedValue(null) } });
    const service = new ContractsService(prisma as any);
    expect(await service.resolveForTicket('cli1', 'loc1', [])).toBeNull();
  });
});
```

Adicionar `contract.findFirst: vi.fn().mockResolvedValue(null)` ao `contract`
base em `makePrisma()` (no topo do arquivo), pra não quebrar os testes já
existentes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: FAIL — `resolveForTicket` ainda devolve sempre `null` sem checar nada, então o teste de "resolve pelo local" falha (`prisma.contract.findFirst` nunca é chamado).

- [ ] **Step 3: Implementar**

Trocar o placeholder por:

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

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add backend/src/contracts
git commit -m "feat(contracts): resolução automática de contrato pelo local/ativo"
```

---

## Task 4: `ContractsService.consumption` (cálculo real)

**Files:**
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`

**Interfaces:**
- Produces: `ContractsService.consumption(contractId): Promise<{ unit: FranchiseUnit; used: number; franchiseAmount: number; exceeded: boolean }>` — substitui o placeholder da Task 2.

- [ ] **Step 1: Adicionar os testes que falham**

```ts
describe('ContractsService.consumption', () => {
  it('VISITS: conta chamados do contrato criados no mês corrente', async () => {
    const prisma = makePrisma({
      contract: {
        findUnique: vi.fn().mockResolvedValue({ franchiseUnit: 'VISITS', franchiseAmount: 4 }),
      },
      ticket: { count: vi.fn().mockResolvedValue(5) },
    });
    const service = new ContractsService(prisma as any);
    const result = await service.consumption('c1');
    expect(result).toEqual({ unit: 'VISITS', used: 5, franchiseAmount: 4, exceeded: true });
    expect(prisma.ticket.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ contractId: 'c1' }) }),
    );
  });

  it('HOURS: soma a duração das visitas fechadas no mês corrente', async () => {
    const prisma = makePrisma({
      contract: {
        findUnique: vi.fn().mockResolvedValue({ franchiseUnit: 'HOURS', franchiseAmount: 10 }),
      },
      visit: {
        findMany: vi.fn().mockResolvedValue([
          { laborStartAt: new Date('2026-09-05T13:00:00.000Z'), laborEndAt: new Date('2026-09-05T14:30:00.000Z') },
          { laborStartAt: new Date('2026-09-06T09:00:00.000Z'), laborEndAt: new Date('2026-09-06T10:00:00.000Z') },
        ]),
      },
    });
    const service = new ContractsService(prisma as any);
    const result = await service.consumption('c1');
    expect(result.unit).toBe('HOURS');
    expect(result.used).toBe(2.5);
    expect(result.exceeded).toBe(false);
  });

  it('404 se o contrato não existir', async () => {
    const prisma = makePrisma({ contract: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new ContractsService(prisma as any);
    await expect(service.consumption('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: FAIL — o placeholder sempre devolve `{ unit: 'VISITS', used: 0, ... }`.

- [ ] **Step 3: Implementar**

Trocar o placeholder por:

```ts
  async consumption(
    contractId: string,
  ): Promise<{ unit: 'VISITS' | 'HOURS'; used: number; franchiseAmount: number; exceeded: boolean }> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      select: { franchiseUnit: true, franchiseAmount: true },
    });
    if (!contract) throw new NotFoundException('Contrato não encontrado.');

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    let used: number;
    if (contract.franchiseUnit === 'VISITS') {
      used = await this.prisma.ticket.count({
        where: { contractId, createdAt: { gte: monthStart, lt: monthEnd } },
      });
    } else {
      const visits = await this.prisma.visit.findMany({
        where: {
          ticket: { contractId },
          laborStartAt: { gte: monthStart, lt: monthEnd },
          laborEndAt: { not: null },
        },
        select: { laborStartAt: true, laborEndAt: true },
      });
      const minutes = visits.reduce(
        (sum, v) => sum + (v.laborEndAt!.getTime() - v.laborStartAt!.getTime()) / 60000,
        0,
      );
      used = Math.round((minutes / 60) * 100) / 100;
    }

    return {
      unit: contract.franchiseUnit,
      used,
      franchiseAmount: contract.franchiseAmount,
      exceeded: used > contract.franchiseAmount,
    };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/contracts/contracts.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Build + testes + commit**

```bash
npm run build && npx vitest run src/contracts
git add backend/src/contracts
git commit -m "feat(contracts): cálculo de consumo de franquia do mês corrente"
```

---

## Task 5: `TicketsService` — vínculo automático ao contrato

**Files:**
- Modify: `backend/src/tickets/tickets.module.ts` (importar `ContractsModule`)
- Modify: `backend/src/tickets/tickets.service.ts`
- Create: `backend/src/tickets/tickets-contract-link.spec.ts`

**Interfaces:**
- Consumes: `ContractsService.resolveForTicket` (Task 3).
- Produces: `Ticket.contractId` preenchido em `create`/`setTicketAssets`; `findOne` inclui `contract: { id, name }`.

- [ ] **Step 1: Importar `ContractsModule` em `tickets.module.ts`**

```ts
import { ContractsModule } from '../contracts/contracts.module.js';
```

Adicionar `ContractsModule` ao array `imports` (junto de `SlaModule`,
`NotificationsModule`).

- [ ] **Step 2: Escrever o teste que falha**

`backend/src/tickets/tickets-contract-link.spec.ts` — testa só o
comportamento novo, sem duplicar a suíte grande já existente em
`tickets.service.spec.ts`:

```ts
import { TicketsService } from './tickets.service.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    ticket: {
      create: vi.fn(),
      findUnique: vi.fn().mockResolvedValue({ id: 't1', clientId: 'cli1', locationId: null, assets: [] }),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ active: true, type: 'CLIENT', clientId: 'cli1' }) },
    location: { findUnique: vi.fn().mockResolvedValue({ id: 'loc1', clientId: 'cli1' }) },
    asset: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    ...overrides,
  };
  (prisma.ticket.create as any).mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 't1', ...data }),
  );
  (prisma.ticket.update as any).mockImplementation(({ data }: any) =>
    Promise.resolve({ id: 't1', ...data }),
  );
  const sla = { dueAt: vi.fn().mockResolvedValue(new Date()) };
  const events = { record: vi.fn() };
  const contracts = { resolveForTicket: vi.fn().mockResolvedValue('c1') };
  const notifier = { created: vi.fn() };
  const ticketNumber = { next: vi.fn().mockResolvedValue('2026-0001') };
  const statusRules = { assertTransition: vi.fn() };
  const service = new TicketsService(
    prisma as any,
    ticketNumber as any,
    sla as any,
    events as any,
    statusRules as any,
    notifier as any,
    contracts as any,
  );
  return { service, prisma, contracts, sla };
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'ADMIN', clientId: null };

describe('TicketsService — vínculo automático a contrato', () => {
  it('create: resolve o contrato pelo local e grava contractId + usa no SLA', async () => {
    const { service, prisma, contracts, sla } = makeDeps();
    await service.create(
      {
        title: 'x',
        description: 'y',
        clientId: 'cli1',
        requesterId: 'req1',
        locationId: 'loc1',
      },
      actor,
    );
    expect(contracts.resolveForTicket).toHaveBeenCalledWith('cli1', 'loc1', []);
    expect(sla.dueAt).toHaveBeenCalledWith('MEDIUM', expect.any(Date), 'c1');
    expect(prisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractId: 'c1' }) }),
    );
  });

  it('setTicketAssets: resolve o contrato pelo local novo e grava contractId', async () => {
    const { service, prisma, contracts } = makeDeps();
    await service.setTicketAssets('t1', { locationId: 'loc1', assetIds: [] }, actor);
    expect(contracts.resolveForTicket).toHaveBeenCalledWith('cli1', 'loc1', []);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractId: 'c1' }) }),
    );
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/tickets/tickets-contract-link.spec.ts`
Expected: FAIL — o construtor de `TicketsService` ainda não aceita um 7º
argumento `contracts`.

- [ ] **Step 4: Implementar em `tickets.service.ts`**

Adicionar o import e o parâmetro do construtor:

```ts
import { ContractsService } from '../contracts/contracts.service.js';
```

No construtor, adicionar como último parâmetro:

```ts
    private readonly contracts: ContractsService,
```

No `create`, trocar:

```ts
    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check `assets.length !== assetIds.length`.
    const assetIds = [...new Set(input.assetIds ?? [])];
    await this.validateLocationAndAssets(clientId, locationId, assetIds);

    // read-only, pode ficar fora da transação
    const slaDueAt = await this.sla.dueAt(priority, new Date());
```

por:

```ts
    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check `assets.length !== assetIds.length`.
    const assetIds = [...new Set(input.assetIds ?? [])];
    await this.validateLocationAndAssets(clientId, locationId, assetIds);
    const contractId = await this.contracts.resolveForTicket(clientId, locationId, assetIds);

    // read-only, pode ficar fora da transação
    const slaDueAt = await this.sla.dueAt(priority, new Date(), contractId ?? undefined);
```

E no `data` do `tx.ticket.create` (dentro do `create`), adicionar `contractId,`
junto de `locationId,`.

No `setTicketAssets`, trocar:

```ts
    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check em validateLocationAndAssets.
    const assetIds = locationId ? [...new Set(input.assetIds)] : [];
    await this.validateLocationAndAssets(ticket.clientId, locationId, assetIds);
```

por:

```ts
    const locationId = input.locationId ?? null;
    // dedup: ids repetidos furam o check em validateLocationAndAssets.
    const assetIds = locationId ? [...new Set(input.assetIds)] : [];
    await this.validateLocationAndAssets(ticket.clientId, locationId, assetIds);
    const contractId = await this.contracts.resolveForTicket(ticket.clientId, locationId, assetIds);
```

E no `data` do `tx.ticket.update` (dentro do `setTicketAssets`), adicionar
`contractId,` junto de `locationId,`.

No `findOne`, adicionar ao `include`:

```ts
        contract: { select: { id: true, name: true } },
```

(logo depois de `location: true,`).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/tickets/tickets-contract-link.spec.ts`
Expected: PASS.

- [ ] **Step 6: Ajustar os testes existentes de `tickets.service.spec.ts`**

O construtor de `TicketsService` ganhou um parâmetro novo — toda instância
criada manualmente nos testes existentes (`tickets.service.spec.ts`,
`tickets-mutations.spec.ts`, `tickets-visibility.spec.ts`,
`tickets-visibility.integration.spec.ts`) precisa passar um 7º argumento. Em
cada arquivo, localizar `new TicketsService(` e adicionar
`{ resolveForTicket: vi.fn().mockResolvedValue(null) } as any,` como último
argumento (ou `{} as any` nos arquivos de integração, que já usam esse
padrão pra outros parâmetros — ver `tickets-visibility.integration.spec.ts`
`svc()`).

- [ ] **Step 7: Rodar toda a suíte de `tickets`**

Run: `npx vitest run src/tickets`
Expected: todos os arquivos passam (nenhuma regressão).

- [ ] **Step 8: Build + commit**

```bash
npm run build
git add backend/src/tickets
git commit -m "feat(contracts): chamado se vincula sozinho ao contrato pelo local/ativo"
```

---

## Task 6: `SlaService` — SLA por contrato

**Files:**
- Modify: `backend/src/sla/sla.service.ts`
- Modify: `backend/src/sla/sla.service.spec.ts`

**Interfaces:**
- Produces: `SlaService.dueAt(priority, from, contractId?)` — já consumido pela Task 5.

- [ ] **Step 1: Adicionar o teste que falha**

Em `backend/src/sla/sla.service.spec.ts`, adicionar (usando o `makePrisma`/
mock já existente no arquivo — se o arquivo mockar `prisma.slaPolicy`
diretamente num objeto simples, seguir o mesmo padrão adicionando
`contractSlaPolicy`):

```ts
describe('SlaService.dueAt — override de contrato', () => {
  it('usa o SlaPolicy global quando não há override', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = new SlaService(prisma as any);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const due = await service.dueAt('MEDIUM', from, 'c1');
    expect(due.toISOString()).toBe('2026-01-01T08:00:00.000Z');
    expect(prisma.contractSlaPolicy.findUnique).toHaveBeenCalledWith({
      where: { contractId_priority: { contractId: 'c1', priority: 'MEDIUM' } },
    });
  });

  it('usa o override do contrato quando existe', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn().mockResolvedValue({ hours: 2 }) },
    };
    const service = new SlaService(prisma as any);
    const from = new Date('2026-01-01T00:00:00.000Z');
    const due = await service.dueAt('MEDIUM', from, 'c1');
    expect(due.toISOString()).toBe('2026-01-01T02:00:00.000Z');
  });

  it('sem contractId, comportamento idêntico ao de antes', async () => {
    const prisma = {
      slaPolicy: { findUnique: vi.fn().mockResolvedValue({ priority: 'MEDIUM', hours: 8 }) },
      contractSlaPolicy: { findUnique: vi.fn() },
    };
    const service = new SlaService(prisma as any);
    await service.dueAt('MEDIUM', new Date('2026-01-01T00:00:00.000Z'));
    expect(prisma.contractSlaPolicy.findUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/sla/sla.service.spec.ts`
Expected: FAIL — `dueAt` ainda não aceita/usa um terceiro argumento.

- [ ] **Step 3: Implementar em `sla.service.ts`**

Trocar:

```ts
  /** `from + hours*3600_000`, lendo a política da prioridade. */
  async dueAt(priority: TicketPriority, from: Date): Promise<Date> {
    const policy = await this.prisma.slaPolicy.findUnique({ where: { priority } });
    if (!policy) {
      throw new NotFoundException(`Política de SLA não encontrada para a prioridade ${priority}.`);
    }
    return new Date(from.getTime() + policy.hours * 3600_000);
  }
```

por:

```ts
  /**
   * `from + hours*3600_000`. Com `contractId`, checa antes o SLA próprio do
   * contrato (`ContractSlaPolicy`); sem override, cai no `SlaPolicy` global —
   * comportamento idêntico ao de antes quando `contractId` é omitido.
   */
  async dueAt(priority: TicketPriority, from: Date, contractId?: string): Promise<Date> {
    if (contractId) {
      const override = await this.prisma.contractSlaPolicy.findUnique({
        where: { contractId_priority: { contractId, priority } },
      });
      if (override) return new Date(from.getTime() + override.hours * 3600_000);
    }
    const policy = await this.prisma.slaPolicy.findUnique({ where: { priority } });
    if (!policy) {
      throw new NotFoundException(`Política de SLA não encontrada para a prioridade ${priority}.`);
    }
    return new Date(from.getTime() + policy.hours * 3600_000);
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/sla/sla.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Build + testes + commit**

```bash
npm run build && npx vitest run src/sla src/tickets
git add backend/src/sla
git commit -m "feat(contracts): SLA por contrato sobrescreve o SLA global por prioridade"
```

---

## Task 7: `ContractPreventiveCron`

**Files:**
- Create: `backend/src/tasks/contract-preventive.cron.ts`
- Create: `backend/src/tasks/contract-preventive.cron.spec.ts`
- Modify: `backend/src/tasks/tasks.module.ts`

**Interfaces:**
- Consumes: `TicketNumberService.next(tx)` (exportado por `TicketsModule`), `TicketEventsService.record` (exportado por `TicketsModule`), `SlaService.dueAt` (exportado por `SlaModule`).
- Produces: `ContractPreventiveCron` — cron `@Cron('0 6 * * *')`.

- [ ] **Step 1: Escrever o teste que falha**

`backend/src/tasks/contract-preventive.cron.spec.ts`:

```ts
import { ContractPreventiveCron } from './contract-preventive.cron.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    ticket: { create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 't1', ...data })) },
    counter: { upsert: vi.fn().mockResolvedValue({ value: 1 }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    ...overrides,
  };
  const ticketNumber = { next: vi.fn().mockResolvedValue('2026-0001') };
  const events = { record: vi.fn() };
  const sla = { dueAt: vi.fn().mockResolvedValue(new Date('2026-10-05T00:00:00.000Z')) };
  const cron = new ContractPreventiveCron(prisma as any, ticketNumber as any, events as any, sla as any);
  return { cron, prisma, ticketNumber, events, sla };
}

describe('ContractPreventiveCron', () => {
  it('sem contratos devidos, não faz nada', async () => {
    const { cron, prisma } = makeDeps();
    await cron.run();
    expect(prisma.ticket.create).not.toHaveBeenCalled();
  });

  it('gera um chamado por Local do escopo (direto + derivado dos ativos) e avança nextGenerationAt', async () => {
    const contract = {
      id: 'c1',
      clientId: 'cli1',
      name: 'Contrato X',
      defaultCategoryId: null,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      nextGenerationAt: new Date('2026-09-01T00:00:00.000Z'),
      preventiveFrequencyMonths: 1,
      locations: [{ id: 'loc1' }],
      assets: [{ id: 'a1', locationId: 'loc2' }],
    };
    const { cron, prisma } = makeDeps({
      contract: { findMany: vi.fn().mockResolvedValue([contract]), update: vi.fn() },
    });
    await cron.run();

    expect(prisma.ticket.create).toHaveBeenCalledTimes(2); // loc1 (direto) + loc2 (via ativo)
    const locIds = (prisma.ticket.create as any).mock.calls.map((c: any) => c[0].data.locationId);
    expect(locIds.sort()).toEqual(['loc1', 'loc2']);

    const loc2Call = (prisma.ticket.create as any).mock.calls.find((c: any) => c[0].data.locationId === 'loc2');
    expect(loc2Call[0].data.assets).toEqual({ connect: [{ id: 'a1' }] });
    expect(loc2Call[0].data.origin).toBe('CONTRACT');
    expect(loc2Call[0].data.needsTriage).toBe(false);
    expect(loc2Call[0].data.contractId).toBe('c1');

    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { nextGenerationAt: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('falha num contrato não impede os demais', async () => {
    const bad = {
      id: 'bad',
      clientId: 'cli1',
      name: 'Ruim',
      defaultCategoryId: null,
      startDate: new Date(),
      nextGenerationAt: new Date(),
      preventiveFrequencyMonths: 1,
      locations: [{ id: 'loc1' }],
      assets: [],
    };
    const good = { ...bad, id: 'good', locations: [{ id: 'loc2' }] };
    const prisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([bad, good]),
        update: vi.fn(),
      },
      ticket: {
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error('boom'))
          .mockImplementation(({ data }: any) => Promise.resolve({ id: 't1', ...data })),
      },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };
    const { cron } = makeDeps(prisma);
    await cron.run();
    expect(prisma.contract.update).toHaveBeenCalledTimes(1);
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'good' } }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/tasks/contract-preventive.cron.spec.ts`
Expected: FAIL — `./contract-preventive.cron.js` não existe.

- [ ] **Step 3: `contract-preventive.cron.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { SlaService } from '../sla/sla.service.js';

interface ContractDue {
  id: string;
  clientId: string;
  name: string;
  defaultCategoryId: string | null;
  startDate: Date;
  nextGenerationAt: Date | null;
  preventiveFrequencyMonths: number | null;
  locations: { id: string }[];
  assets: { id: string; locationId: string }[];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Gera, uma vez por dia, os chamados preventivos dos contratos que chegaram na data. */
@Injectable()
export class ContractPreventiveCron {
  private readonly logger = new Logger(ContractPreventiveCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketNumber: TicketNumberService,
    private readonly events: TicketEventsService,
    private readonly sla: SlaService,
  ) {}

  @Cron('0 6 * * *')
  async run(): Promise<void> {
    const due = (await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        preventiveFrequencyMonths: { not: null },
        nextGenerationAt: { lte: new Date() },
      },
      include: {
        locations: { select: { id: true } },
        assets: { select: { id: true, locationId: true } },
      },
    })) as ContractDue[];

    for (const contract of due) {
      try {
        await this.generateFor(contract);
      } catch (err) {
        this.logger.error(
          `Falha ao gerar preventiva do contrato ${contract.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }

  private async generateFor(contract: ContractDue): Promise<void> {
    const locationIds = new Set(contract.locations.map((l) => l.id));
    for (const a of contract.assets) locationIds.add(a.locationId);

    for (const locationId of locationIds) {
      const assetIds = contract.assets.filter((a) => a.locationId === locationId).map((a) => a.id);
      const slaDueAt = await this.sla.dueAt('MEDIUM', new Date(), contract.id);

      await this.prisma.$transaction(async (tx) => {
        const number = await this.ticketNumber.next(tx);
        const created = await tx.ticket.create({
          data: {
            number,
            title: `Manutenção preventiva — ${contract.name}`,
            description: `Chamado gerado automaticamente pelo contrato "${contract.name}".`,
            clientId: contract.clientId,
            requesterId: null,
            categoryId: contract.defaultCategoryId,
            priority: 'MEDIUM',
            status: 'OPEN',
            origin: 'CONTRACT',
            locationId,
            contractId: contract.id,
            needsTriage: false,
            slaDueAt,
            ...(assetIds.length ? { assets: { connect: assetIds.map((id) => ({ id })) } } : {}),
          },
        });
        await this.events.record(tx, created.id, 'CREATED', {}, undefined);
      });
    }

    await this.prisma.contract.update({
      where: { id: contract.id },
      data: {
        nextGenerationAt: addMonths(
          contract.nextGenerationAt ?? contract.startDate,
          contract.preventiveFrequencyMonths!,
        ),
      },
    });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/tasks/contract-preventive.cron.spec.ts`
Expected: PASS.

- [ ] **Step 5: Registrar em `tasks.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { SlaModule } from '../sla/sla.module.js';
import { SlaBreachCron } from './sla-breach.cron.js';
import { BackupCron } from '../backup/backup.cron.js';
import { ContractPreventiveCron } from './contract-preventive.cron.js';

@Module({
  imports: [NotificationsModule, BackupModule, TicketsModule, SlaModule],
  providers: [SlaBreachCron, BackupCron, ContractPreventiveCron],
})
export class TasksModule {}
```

- [ ] **Step 6: Build + testes + commit**

```bash
npm run build && npx vitest run src/tasks
git add backend/src/tasks
git commit -m "feat(contracts): cron de geração automática de chamados preventivos"
```

---

## Task 8: `ContractExpiryCron` + template de e-mail

**Files:**
- Create: `backend/src/tasks/contract-expiry.cron.ts`
- Create: `backend/src/tasks/contract-expiry.cron.spec.ts`
- Modify: `backend/src/email/templates.ts`
- Modify: `backend/src/tasks/tasks.module.ts`

**Interfaces:**
- Consumes: `EmailService.send`, `EmailService.brand()` (`../email/email.service.js`).
- Produces: `contractExpiring(contract, brand?): RenderedEmail` em `templates.ts`; `ContractExpiryCron` — cron `@Cron('0 8 * * *')`.

- [ ] **Step 1: Template de e-mail**

Em `backend/src/email/templates.ts`, adicionar (perto das outras funções de
template, reaproveitando `wrap`/`esc` já existentes no arquivo):

```ts
export function contractExpiring(
  contract: { name: string; endDate: Date; client: { name: string } },
  brand?: BrandInfo,
): RenderedEmail {
  const dateStr = contract.endDate.toLocaleDateString('pt-BR');
  return {
    subject: `Contrato "${contract.name}" vence em breve`,
    html: wrap(
      'Contrato perto do fim',
      `<p>O contrato <strong>${esc(contract.name)}</strong> do cliente <strong>${esc(contract.client.name)}</strong> vence em <strong>${esc(dateStr)}</strong>.</p>` +
        `<p>Avalie renovação ou reajuste na ficha do contrato.</p>`,
      brand,
    ),
  };
}
```

- [ ] **Step 2: Escrever o teste que falha**

`backend/src/tasks/contract-expiry.cron.spec.ts`:

```ts
import { ContractExpiryCron } from './contract-expiry.cron.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    user: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', email: 'admin@x.test' }]) },
    ...overrides,
  };
  const email = {
    send: vi.fn().mockResolvedValue(undefined),
    brand: vi.fn().mockResolvedValue({}),
  };
  const cron = new ContractExpiryCron(prisma as any, email as any);
  return { cron, prisma, email };
}

describe('ContractExpiryCron', () => {
  it('sem contratos vencendo, não envia nada', async () => {
    const { cron, email } = makeDeps();
    await cron.run();
    expect(email.send).not.toHaveBeenCalled();
  });

  it('envia pra todo ADMIN e marca renewalWarnedAt', async () => {
    const contract = {
      id: 'c1',
      name: 'Contrato X',
      endDate: new Date(Date.now() + 10 * 24 * 3600_000),
      client: { name: 'Cliente Y' },
    };
    const { cron, prisma, email } = makeDeps({
      contract: { findMany: vi.fn().mockResolvedValue([contract]), update: vi.fn() },
    });
    await cron.run();
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'admin@x.test', subject: expect.stringContaining('Contrato X') }),
    );
    expect(prisma.contract.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { renewalWarnedAt: expect.any(Date) },
    });
  });

  it('um contrato falhando não impede o aviso dos demais', async () => {
    const bad = { id: 'bad', name: 'Ruim', endDate: new Date(), client: { name: 'X' } };
    const good = { id: 'good', name: 'Bom', endDate: new Date(), client: { name: 'Y' } };
    const prisma = {
      contract: {
        findMany: vi.fn().mockResolvedValue([bad, good]),
        update: vi.fn(),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'a1', email: 'admin@x.test' }]) },
    };
    const email = {
      send: vi.fn().mockRejectedValueOnce(new Error('smtp fora')).mockResolvedValue(undefined),
      brand: vi.fn().mockResolvedValue({}),
    };
    const cron = new ContractExpiryCron(prisma as any, email as any);
    await cron.run();
    expect(prisma.contract.update).toHaveBeenCalledTimes(1);
    expect(prisma.contract.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'good' } }));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/tasks/contract-expiry.cron.spec.ts`
Expected: FAIL — `./contract-expiry.cron.js` não existe.

- [ ] **Step 4: `contract-expiry.cron.ts`**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { contractExpiring } from '../email/templates.js';

const WARNING_WINDOW_DAYS = 30;

/** Avisa os ADMIN por e-mail quando um contrato está a ≤30 dias do fim da vigência. Uma vez por contrato. */
@Injectable()
export class ContractExpiryCron {
  private readonly logger = new Logger(ContractExpiryCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 8 * * *')
  async run(): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WARNING_WINDOW_DAYS * 24 * 3600_000);
    const expiring = await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: now, lte: windowEnd },
        renewalWarnedAt: null,
      },
      include: { client: { select: { name: true } } },
    });
    if (!expiring.length) return;

    const admins = await this.prisma.user.findMany({
      where: { type: 'INTERNAL', role: 'ADMIN', active: true },
    });
    const brand = await this.email.brand();

    for (const contract of expiring) {
      try {
        const tpl = contractExpiring(contract, brand);
        for (const admin of admins) {
          await this.email.send({ to: admin.email, ...tpl });
        }
        await this.prisma.contract.update({
          where: { id: contract.id },
          data: { renewalWarnedAt: now },
        });
      } catch (err) {
        this.logger.error(
          `Falha ao avisar vencimento do contrato ${contract.id}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/tasks/contract-expiry.cron.spec.ts`
Expected: PASS.

- [ ] **Step 6: Registrar em `tasks.module.ts`**

```ts
import { EmailModule } from '../email/email.module.js';
import { ContractExpiryCron } from './contract-expiry.cron.js';
```

Adicionar `EmailModule` ao array `imports` e `ContractExpiryCron` ao array
`providers`.

- [ ] **Step 7: Build + testes + commit**

```bash
npm run build && npx vitest run src/tasks src/email
git add backend/src/tasks backend/src/email
git commit -m "feat(contracts): aviso automático de vencimento próximo"
```

---

## Task 9: Integração — ciclo completo (Postgres real)

**Files:**
- Create: `backend/src/contracts/contracts.integration.spec.ts`

**Interfaces:**
- Consumes: `ContractsService`, `TicketsService`, `SlaService` reais + Prisma real.

- [ ] **Step 1: Escrever o teste de integração**

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractsService } from './contracts.service.js';
import { SlaService } from '../sla/sla.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Escopo do contrato → chamado no local
// coberto → contractId resolvido + SLA do contrato aplicado. Sobe com
// `docker compose up -d postgres`. Sem banco no ar, pula com aviso (exit 0).
const PFX = `CTR-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.contract.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Contracts — vínculo automático e SLA (Postgres real)', () => {
  let contracts: ContractsService;
  let tickets: TicketsService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[contracts.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Matriz` } });
    id.clientId = client.id;
    id.locationId = location.id;

    const prismaService = prisma as unknown as PrismaService;
    contracts = new ContractsService(prismaService);
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {} };
    tickets = new TicketsService(prismaService, ticketNumber, sla, events, statusRules, notifier as any, contracts);

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('chamado no local do contrato resolve contractId e usa o SLA do contrato', async () => {
    if (!available) return;

    const contract = await contracts.create({
      clientId: id.clientId,
      name: `${PFX} Contrato`,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      franchiseUnit: 'VISITS',
      franchiseAmount: 2,
      locationIds: [id.locationId],
      slaOverrides: [{ priority: 'MEDIUM', hours: 2 }],
    });
    expect(contract.locations).toHaveLength(1);

    const before = new Date();
    const ticket = await tickets.create(
      {
        title: 'Chamado no escopo',
        description: 'desc',
        clientId: id.clientId,
        locationId: id.locationId,
      },
      { id: 'sys', type: 'INTERNAL', role: 'ADMIN', clientId: null },
    );
    expect(ticket.contractId).toBe(contract.id);
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeLessThan(3 * 3600_000 + 60_000);
    expect(ticket.slaDueAt!.getTime() - before.getTime()).toBeGreaterThan(1 * 3600_000);

    const consumption = await contracts.consumption(contract.id);
    expect(consumption.used).toBe(1);
    expect(consumption.exceeded).toBe(false);
  });
});
```

Nota: `tickets.create` exige `requesterId` pra origem `MANUAL` de ator
interno só se `hasParties` (cliente+solicitante); aqui só `clientId` é
passado sem `requesterId`, então `hasParties` é `false` e o chamado nasce
com `needsTriage` calculado normalmente — como o teste só valida
`contractId`/`slaDueAt`, isso não afeta o resultado. Se o `create` rejeitar
por falta de `requesterId`, adicionar um `User` de teste (`type: 'CLIENT'`,
`role: 'CONTACT'`, `clientId: id.clientId`) e passar `requesterId` no body —
mesmo padrão do `visits.integration.spec.ts`.

- [ ] **Step 2: Rodar**

Run: `npm run test:integration -- contracts.integration`
Expected: PASS com Postgres local; pula com aviso sem banco.

- [ ] **Step 3: Commit**

```bash
git add backend/src/contracts/contracts.integration.spec.ts
git commit -m "test(contracts): integração do vínculo automático e SLA por contrato"
```

---

## Task 10: CHANGELOG (parcial) — checkpoint de backend

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:** nenhuma.

- [ ] **Step 1: Registrar o progresso do backend em `[Não lançado]`**

```markdown
## [Não lançado]

### Adicionado
- **Contratos de manutenção recorrente**: vigência, valor mensal, escopo de
  Locais/Ativos, franquia (visitas ou horas/mês), SLA próprio opcional por
  prioridade.
- Chamado dentro do escopo de um contrato ativo se vincula sozinho a ele.
- Geração automática de chamados preventivos no calendário do contrato (um
  por Local do escopo).
- Aviso automático por e-mail (ADMIN) 30 dias antes do fim da vigência.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog parcial da fase 0.5.0 (backend)"
```

---

## Task 11: Frontend — `lib/contracts.ts`

**Files:**
- Create: `frontend/src/lib/contracts.ts`
- Modify: `frontend/src/lib/tickets.ts` (`TicketOrigin`/`ORIGIN_LABELS` ganham `CONTRACT`; `TicketDetail` ganha `contract`)

**Interfaces:**
- Produces: tipos `Contract`, `ContractStatus`, `FranchiseUnit`, `ContractSlaOverride`; hooks `useContracts(filter)`, `useContract(id)`, `useCreateContract()`, `useUpdateContract(id)`, `useCancelContract(id)`; `CONTRACT_STATUS_LABELS`.

- [ ] **Step 1: Ajustar `frontend/src/lib/tickets.ts`**

No `TicketOrigin`:

```ts
export type TicketOrigin = 'EMAIL' | 'PORTAL' | 'MANUAL' | 'CONTRACT';
```

No `ORIGIN_LABELS`:

```ts
export const ORIGIN_LABELS: Record<TicketOrigin, string> = {
  EMAIL: 'E-mail',
  PORTAL: 'Portal',
  MANUAL: 'Manual',
  CONTRACT: 'Contrato',
};
```

No `TicketDetail`, adicionar:

```ts
  contract?: { id: string; name: string } | null;
```

- [ ] **Step 2: `frontend/src/lib/contracts.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export type ContractStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
export type FranchiseUnit = 'VISITS' | 'HOURS';

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  ACTIVE: 'Ativo',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

export const FRANCHISE_UNIT_LABELS: Record<FranchiseUnit, string> = {
  VISITS: 'visitas/mês',
  HOURS: 'horas/mês',
};

export interface ContractSlaOverride {
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  hours: number;
}

export interface ContractConsumption {
  unit: FranchiseUnit;
  used: number;
  franchiseAmount: number;
  exceeded: boolean;
}

export interface Contract {
  id: string;
  clientId: string;
  client?: { id: string; name: string };
  name: string;
  status: ContractStatus;
  startDate: string;
  endDate: string;
  monthlyValue: number | null;
  franchiseUnit: FranchiseUnit;
  franchiseAmount: number;
  preventiveFrequencyMonths: number | null;
  defaultCategoryId: string | null;
  notes: string | null;
  locations: { id: string; name: string }[];
  assets: { id: string; label: string }[];
  slaOverrides: ContractSlaOverride[];
  consumption: ContractConsumption;
}

export interface ContractFilters {
  clientId?: string;
  status?: ContractStatus;
}

function toQuery(f: ContractFilters): string {
  const p = new URLSearchParams();
  if (f.clientId) p.set('clientId', f.clientId);
  if (f.status) p.set('status', f.status);
  return p.toString();
}

export function useContracts(filter: ContractFilters) {
  return useQuery({
    queryKey: ['contracts', filter],
    queryFn: () => api<Contract[]>(`/contracts?${toQuery(filter)}`),
  });
}

export function useContract(id: string) {
  return useQuery({
    queryKey: ['contract', id],
    queryFn: () => api<Contract>(`/contracts/${id}`),
    enabled: !!id,
  });
}

export interface ContractInput {
  clientId: string;
  name: string;
  startDate: string;
  endDate: string;
  monthlyValue?: number;
  franchiseUnit: FranchiseUnit;
  franchiseAmount: number;
  preventiveFrequencyMonths?: number;
  defaultCategoryId?: string;
  notes?: string;
  locationIds?: string[];
  assetIds?: string[];
  slaOverrides?: ContractSlaOverride[];
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ContractInput) => api<Contract>('/contracts', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contracts'] }),
  });
}

export function useUpdateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ContractInput>) => api<Contract>(`/contracts/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

export function useCancelContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Contract>(`/contracts/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contract', id] });
      qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}
```

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/contracts.ts frontend/src/lib/tickets.ts
git commit -m "feat(frontend): tipos e hooks de contratos"
```

---

## Task 12: Frontend — `/app/contratos` (lista) + `/app/contratos/novo`

**Files:**
- Create: `frontend/src/app/app/contratos/page.tsx`
- Create: `frontend/src/app/app/contratos/novo/page.tsx`

**Interfaces:**
- Consumes: `useContracts`, `useCreateContract` (Task 11); `Paged`, `PublicUser`-like client type (`/clients`).

- [ ] **Step 1: `page.tsx` (lista)**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import {
  CONTRACT_STATUS_LABELS,
  FRANCHISE_UNIT_LABELS,
  useContracts,
  type Contract,
  type ContractStatus,
} from '@/lib/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

function statusTone(s: ContractStatus) {
  return s === 'ACTIVE' ? 'green' : s === 'EXPIRED' ? 'amber' : 'neutral';
}

export default function ContractsPage() {
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<ContractStatus | ''>('');
  const { data: contracts, isLoading } = useContracts({
    clientId: clientId || undefined,
    status: status || undefined,
  });
  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Contratos</h1>
        <Link href="/app/contratos/novo">
          <Button className="h-9">Novo contrato</Button>
        </Link>
      </div>

      <div className="flex gap-2">
        <Select className="h-9 w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | '')}>
          <option value="">Todos os status</option>
          {Object.entries(CONTRACT_STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (contracts?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum contrato encontrado.</p>
      )}

      <ul className="flex flex-col gap-1">
        {contracts?.map((c) => (
          <ContractRow key={c.id} contract={c} />
        ))}
      </ul>
    </div>
  );
}

function ContractRow({ contract }: { contract: Contract }) {
  return (
    <li>
      <Link
        href={`/app/contratos/${contract.id}`}
        className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
      >
        <span className="font-medium">{contract.name}</span>
        <span className="text-muted-foreground">{contract.client?.name}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(contract.startDate).toLocaleDateString('pt-BR')}–
          {new Date(contract.endDate).toLocaleDateString('pt-BR')}
        </span>
        <Badge tone={statusTone(contract.status)}>{CONTRACT_STATUS_LABELS[contract.status]}</Badge>
        <span className="ml-auto flex items-center gap-2 text-xs">
          {contract.consumption.used}/{contract.consumption.franchiseAmount}{' '}
          {FRANCHISE_UNIT_LABELS[contract.consumption.unit]}
          {contract.consumption.exceeded && <Badge tone="amber">Excedente</Badge>}
        </span>
      </Link>
    </li>
  );
}
```

- [ ] **Step 2: `novo/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { useCreateContract, type FranchiseUnit } from '@/lib/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export default function NewContractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const create = useCreateContract();

  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [monthlyValue, setMonthlyValue] = useState('');
  const [franchiseUnit, setFranchiseUnit] = useState<FranchiseUnit>('VISITS');
  const [franchiseAmount, setFranchiseAmount] = useState('4');

  const { data: clients } = useQuery({
    queryKey: ['clients', 'all'],
    queryFn: () => api<Paged<{ id: string; name: string }>>('/clients?pageSize=100'),
  });

  function submit() {
    if (!clientId || !name.trim() || !startDate || !endDate) {
      toast.error('Preencha cliente, nome e vigência.');
      return;
    }
    create.mutate(
      {
        clientId,
        name: name.trim(),
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        monthlyValue: monthlyValue ? Number(monthlyValue) : undefined,
        franchiseUnit,
        franchiseAmount: Number(franchiseAmount),
      },
      {
        onSuccess: (created) => {
          toast.success('Contrato criado.');
          router.push(`/app/contratos/${created.id}`);
        },
        onError: onErr,
      },
    );
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-lg font-semibold">Novo contrato</h1>

      <div className="flex flex-col gap-1.5">
        <Label>Cliente</Label>
        <Select value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={!!searchParams.get('clientId')}>
          <option value="">Selecione…</option>
          {clients?.data.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Nome</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Contrato Matriz 2026" />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Início</Label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Fim</Label>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Valor mensal (R$)</Label>
        <Input type="number" min="0" value={monthlyValue} onChange={(e) => setMonthlyValue(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Franquia — unidade</Label>
          <Select value={franchiseUnit} onChange={(e) => setFranchiseUnit(e.target.value as FranchiseUnit)}>
            <option value="VISITS">Visitas/mês</option>
            <option value="HOURS">Horas/mês</option>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Franquia — quantidade</Label>
          <Input type="number" min="1" value={franchiseAmount} onChange={(e) => setFranchiseAmount(e.target.value)} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Escopo (Locais/Ativos) e SLA por prioridade se editam na ficha, depois de criar.
      </p>

      <Button className="h-9" disabled={create.isPending} onClick={submit}>
        Criar contrato
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/app/contratos/page.tsx frontend/src/app/app/contratos/novo
git commit -m "feat(frontend): lista de contratos e formulário de criação"
```

---

## Task 13: Frontend — `/app/contratos/[id]` (ficha completa)

**Files:**
- Create: `frontend/src/app/app/contratos/[id]/page.tsx`

**Interfaces:**
- Consumes: `useContract`, `useUpdateContract`, `useCancelContract` (Task 11).

- [ ] **Step 1: `page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type Paged } from '@/lib/tickets';
import { type Asset } from '@/lib/assets';
import {
  CONTRACT_STATUS_LABELS,
  FRANCHISE_UNIT_LABELS,
  useCancelContract,
  useContract,
  useUpdateContract,
  type ContractSlaOverride,
} from '@/lib/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const PRIORITY_LABEL: Record<(typeof PRIORITIES)[number], string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
  URGENT: 'Urgente',
};

export default function ContractDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { data: contract, isLoading } = useContract(id);
  const update = useUpdateContract(id);
  const cancel = useCancelContract(id);

  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [slaHours, setSlaHours] = useState<Record<string, string>>({});

  const { data: locations } = useQuery({
    queryKey: ['locations', contract?.clientId],
    queryFn: () =>
      api<Paged<{ id: string; name: string }>>(`/locations?clientId=${contract!.clientId}&pageSize=100`),
    enabled: !!contract,
  });
  const { data: assets } = useQuery({
    queryKey: ['assets', contract?.clientId],
    queryFn: () => api<Paged<Asset>>(`/assets?clientId=${contract!.clientId}&pageSize=200`),
    enabled: !!contract,
  });

  useEffect(() => {
    if (!contract) return;
    setLocationIds(contract.locations.map((l) => l.id));
    setAssetIds(contract.assets.map((a) => a.id));
    const overrides: Record<string, string> = {};
    for (const o of contract.slaOverrides) overrides[o.priority] = String(o.hours);
    setSlaHours(overrides);
  }, [contract]);

  if (isLoading || !contract) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  function saveScope() {
    update.mutate(
      { locationIds, assetIds },
      { onSuccess: () => toast.success('Escopo atualizado.'), onError: onErr },
    );
  }

  function saveSla() {
    const overrides: ContractSlaOverride[] = PRIORITIES.filter((p) => slaHours[p]?.trim()).map((p) => ({
      priority: p,
      hours: Number(slaHours[p]),
    }));
    update.mutate(
      { slaOverrides: overrides },
      { onSuccess: () => toast.success('SLA do contrato atualizado.'), onError: onErr },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{contract.client?.name}</p>
          <h1 className="text-lg font-semibold">{contract.name}</h1>
        </div>
        <Badge tone={contract.status === 'ACTIVE' ? 'green' : contract.status === 'EXPIRED' ? 'amber' : 'neutral'}>
          {CONTRACT_STATUS_LABELS[contract.status]}
        </Badge>
      </div>

      <section className="grid max-w-xl grid-cols-2 gap-3 rounded-lg border border-border p-3 text-sm">
        <div>
          <span className="text-xs uppercase text-muted-foreground">Vigência</span>
          <p>
            {new Date(contract.startDate).toLocaleDateString('pt-BR')} –{' '}
            {new Date(contract.endDate).toLocaleDateString('pt-BR')}
          </p>
        </div>
        <div>
          <span className="text-xs uppercase text-muted-foreground">Valor mensal</span>
          <p>{contract.monthlyValue != null ? `R$ ${contract.monthlyValue.toFixed(2)}` : '—'}</p>
        </div>
        <div>
          <span className="text-xs uppercase text-muted-foreground">Consumo do mês</span>
          <p>
            {contract.consumption.used}/{contract.consumption.franchiseAmount}{' '}
            {FRANCHISE_UNIT_LABELS[contract.consumption.unit]}
            {contract.consumption.exceeded && (
              <Badge tone="amber" className="ml-2">
                Excedente
              </Badge>
            )}
          </p>
        </div>
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-sm font-semibold">Escopo — Locais</h2>
        <div className="flex flex-col gap-1 rounded-md border border-input p-2">
          {locations?.data.map((l) => (
            <label key={l.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={locationIds.includes(l.id)}
                onChange={(e) =>
                  setLocationIds((prev) =>
                    e.target.checked ? [...prev, l.id] : prev.filter((x) => x !== l.id),
                  )
                }
              />
              {l.name}
            </label>
          ))}
        </div>
        <h2 className="text-sm font-semibold">Escopo — Ativos</h2>
        <div className="flex flex-col gap-1 rounded-md border border-input p-2">
          {assets?.data.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={assetIds.includes(a.id)}
                onChange={(e) =>
                  setAssetIds((prev) =>
                    e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                  )
                }
              />
              {a.label}
            </label>
          ))}
        </div>
        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveScope}>
          Salvar escopo
        </Button>
      </section>

      <section className="flex max-w-xl flex-col gap-2">
        <h2 className="text-sm font-semibold">SLA do contrato (opcional)</h2>
        {PRIORITIES.map((p) => (
          <div key={p} className="flex items-center gap-3">
            <Label className="w-24">{PRIORITY_LABEL[p]}</Label>
            <Input
              type="number"
              min="1"
              placeholder="usa o global"
              className="w-32"
              value={slaHours[p] ?? ''}
              onChange={(e) => setSlaHours((prev) => ({ ...prev, [p]: e.target.value }))}
            />
            <span className="text-sm text-muted-foreground">horas</span>
          </div>
        ))}
        <Button variant="outline" className="h-9 self-start" disabled={update.isPending} onClick={saveSla}>
          Salvar SLA
        </Button>
      </section>

      {contract.status === 'ACTIVE' && (
        <Button
          variant="outline"
          className="h-9 w-fit text-red-600"
          disabled={cancel.isPending}
          onClick={() => {
            if (confirm('Cancelar este contrato?')) {
              cancel.mutate(undefined, { onSuccess: () => toast.success('Contrato cancelado.'), onError: onErr });
            }
          }}
        >
          Cancelar contrato
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add "frontend/src/app/app/contratos/[id]"
git commit -m "feat(frontend): ficha do contrato (escopo, SLA, consumo, cancelamento)"
```

---

## Task 14: Frontend — aba Contratos no cliente + badge no chamado + nav

**Files:**
- Modify: `frontend/src/app/app/clientes/[id]/page.tsx`
- Modify: `frontend/src/components/ticket-sidebar.tsx`
- Modify: `frontend/src/components/nav.tsx`

**Interfaces:**
- Consumes: `useContracts` (Task 11).

- [ ] **Step 1: Aba Contratos no cliente**

Em `clientes/[id]/page.tsx`, adicionar o import:

```tsx
import { CONTRACT_STATUS_LABELS, useContracts } from '@/lib/contracts';
```

Adicionar o componente (mesmo molde de outras abas simples do arquivo):

```tsx
function ContractsTab({ clientId }: { clientId: string }) {
  const { data: contracts } = useContracts({ clientId });
  return (
    <div className="flex max-w-xl flex-col gap-3 pt-4">
      <Link href={`/app/contratos/novo?clientId=${clientId}`}>
        <Button className="h-9">Novo contrato</Button>
      </Link>
      <ul className="flex flex-col gap-1">
        {contracts?.map((c) => (
          <li key={c.id}>
            <Link
              href={`/app/contratos/${c.id}`}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              <span className="font-medium">{c.name}</span>
              <span className="ml-auto text-xs text-muted-foreground">{CONTRACT_STATUS_LABELS[c.status]}</span>
            </Link>
          </li>
        ))}
        {contracts?.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum contrato.</p>
        )}
      </ul>
    </div>
  );
}
```

No array `tabs` (perto de `{ value: 'ativos', label: 'Ativos' }`), adicionar
`{ value: 'contratos', label: 'Contratos' }`; e na renderização condicional,
`{tab === 'contratos' && <ContractsTab clientId={id} />}`.

- [ ] **Step 2: Badge de contrato no chamado**

Em `ticket-sidebar.tsx`, adicionar depois da `Row` de "Ativos":

```tsx
        <Row label="Contrato">
          {ticket.contract ? (
            <a href={`/app/contratos/${ticket.contract.id}`} className="underline">
              {ticket.contract.name}
            </a>
          ) : (
            '—'
          )}
        </Row>
```

- [ ] **Step 3: Nav**

Em `nav.tsx`, dentro de `appLinks`, adicionar `{ href: '/app/contratos', label: 'Contratos' }` na lista fixa (depois de `Clientes`, antes de `Ativos`):

```ts
  links.push(
    { href: '/app/clientes', label: 'Clientes' },
    { href: '/app/contratos', label: 'Contratos' },
    { href: '/app/ativos', label: 'Ativos' },
    { href: '/app/config', label: 'Configurações' },
  );
```

- [ ] **Step 4: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/app/clientes/[id]/page.tsx" frontend/src/components/ticket-sidebar.tsx frontend/src/components/nav.tsx
git commit -m "feat(frontend): aba Contratos no cliente, badge no chamado e nav"
```

---

## Task 15: E2E Playwright — contrato vincula chamado automaticamente

**Files:**
- Create: `frontend/e2e/contrato-vincula-chamado.spec.ts`

**Interfaces:**
- Consumes: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (`./seed-e2e.ts`, já existentes).

- [ ] **Step 1: `contrato-vincula-chamado.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('contrato com local no escopo vincula o chamado automaticamente', async ({ page }) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const local = `Local Contrato E2E ${stamp}`;
  const nomeContrato = `Contrato E2E ${stamp}`;
  const titulo = `Chamado contrato E2E ${stamp}`;

  await loginAsAdmin(page);

  // 1. Cliente E2E → aba Locais → novo local
  await page.goto('/app/clientes/e2e-client');
  await page.getByRole('button', { name: 'Locais' }).click();
  await page.getByRole('button', { name: 'Novo local' }).click();
  await page.locator('#l-name').fill(local);
  await page.getByRole('button', { name: 'Criar local' }).click();
  await expect(page.getByRole('cell', { name: local })).toBeVisible();

  // 2. Cliente E2E → aba Contratos → novo contrato cobrindo esse local
  await page.getByRole('button', { name: 'Contratos' }).click();
  await page.getByRole('button', { name: 'Novo contrato' }).click();
  await page.waitForURL(/\/app\/contratos\/novo/);
  await page.locator('#name').fill(nomeContrato);
  const hoje = new Date().toISOString().slice(0, 10);
  const proximoAno = new Date(Date.now() + 365 * 24 * 3600_000).toISOString().slice(0, 10);
  await page.locator('input[type="date"]').nth(0).fill(hoje);
  await page.locator('input[type="date"]').nth(1).fill(proximoAno);
  await page.getByRole('button', { name: 'Criar contrato' }).click();
  await page.waitForURL(/\/app\/contratos\/(?!novo)[^/]+$/);

  // 3. Ficha do contrato → marca o local no escopo → salva
  await page.getByText(local).click();
  await page.getByRole('button', { name: 'Salvar escopo' }).click();
  await expect(page.getByText('Escopo atualizado.')).toBeVisible();

  // 4. Novo chamado nesse local → detalhe mostra o contrato vinculado
  await page.goto('/app/chamados/novo');
  await page.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Chamado gerado pelo smoke E2E de contrato.');
  await page.locator('select').nth(4).selectOption({ label: local });
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);
  await expect(page.getByText(nomeContrato)).toBeVisible();
});
```

- [ ] **Step 2: Ajustar `#name` e o label do checkbox de local na ficha do contrato, se necessário**

O `Input` de nome do contrato em `/app/contratos/novo` (Task 12) não tem
`id="name"` — adicionar `id="name"` ao `<Input>` de nome nesse arquivo pra o
seletor `#name` funcionar. Rodar de novo depois do ajuste.

- [ ] **Step 3: Rodar**

Run (em `frontend/`, com Postgres + backend + frontend de pé — mesmo
procedimento manual da fase 0.4.0): `npx playwright test e2e/contrato-vincula-chamado.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/contrato-vincula-chamado.spec.ts frontend/src/app/app/contratos/novo/page.tsx
git commit -m "test(e2e): smoke de contrato vinculando chamado automaticamente"
```

---

## Task 16: CHANGELOG final e versão 0.5.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Interfaces:** nenhuma (só metadados de release).

- [ ] **Step 1: Completar o `CHANGELOG.md`**

Substituir a seção `## [Não lançado]` (já com o registro parcial da Task 10)
por:

```markdown
## [Não lançado]

## [0.5.0] - <DATA_DO_RELEASE>

### Adicionado
- **Contratos de manutenção recorrente**: vigência, valor mensal, escopo de
  Locais/Ativos, franquia (visitas ou horas/mês), SLA próprio opcional por
  prioridade.
- Chamado dentro do escopo de um contrato ativo se vincula sozinho a ele.
- Geração automática de chamados preventivos no calendário do contrato (um
  por Local do escopo).
- Aviso automático por e-mail (ADMIN) 30 dias antes do fim da vigência.
- Ficha de contrato (`/app/contratos`) com escopo editável, SLA por
  prioridade, consumo do mês e cancelamento; aba Contratos no cliente; badge
  de contrato no chamado.
```

Ajustar `<DATA_DO_RELEASE>` pra data real do commit de release.

- [ ] **Step 2: Bump de versão**

Em `backend/package.json` e `frontend/package.json`, trocar
`"version": "0.4.0"` por `"version": "0.5.0"`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md backend/package.json frontend/package.json
git commit -m "chore: release 0.5.0 — contratos de manutenção recorrente"
git tag v0.5.0
```

---

## Notas de execução

- **Deploy** (bump de `deploy/build-and-push.sh`, `deploy/stack.env.example`,
  `portainer-stack.env`, build+push das imagens Docker Hub) fica de fora
  deste plano — mesma decisão travada em [[deploy-pergunta-antes]]: perguntar
  ao usuário no fim antes de rodar.
- **Push→pull**: depois do release, `git push` no `os-exec` e sincronizar
  `Z:/Projetos/OS` (pull --ff-only), conforme [[push-implica-pull-z]].
