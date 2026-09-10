# Ativos + Locais (Fase 0.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o campo de texto `Ticket.equipment` por um cadastro real de parque instalado — Locais e Ativos por cliente, chamado vinculado a Local + N Ativos, histórico por ativo e importação CSV.

**Architecture:** Três módulos NestJS novos (`asset-types`, `locations`, `assets`) no mesmo padrão de `clients`/`categories` (service + controller + module + DTOs class-validator, envelope de paginação `{data,total,page,pageSize}`). Credenciais de equipamento cifradas com o util AES existente (`settings/crypto.util.ts`). Fotos de ativo reutilizam `StorageService` e o `FileInterceptor` de `attachments`. Frontend: nova área `/app/ativos` (lista + ficha), abas no cliente, aba em Configurações, e ajuste do form de chamado. Sem migração de dados: `equipment` legado fica só-leitura.

**Tech Stack:** NestJS (ESM, imports `.js`), Prisma 6 + Postgres, class-validator, Vitest (unit + integration com Postgres real), Next.js App Router + React Query + shadcn/ui, `csv-parse`.

**Spec:** `docs/superpowers/specs/2026-09-09-ativos-locais-design.md`

## Global Constraints

- **Base:** `main` @ `ba90ffd` (release 0.2.0 já lançada).
- **Execução em disco local:** rodar `npm`/`prisma`/testes em `C:/Users/renan/os-exec` (clone com `origin = github.com/onedayinfo/OS`). `Z:/Projetos/OS` é working copy do usuário, mantida por push→pull-ff. `next dev`/`vitest` no share SMB estouram timeout.
- **Imports ESM:** todo import relativo termina em `.js` (ex: `./assets.service.js`), mesmo apontando para `.ts`.
- **Papéis:** internos `ADMIN`/`AGENT`; cliente `MANAGER`/`CONTACT`. Nesta fase ativos/locais são **só internos** — nada no portal.
- **`@Roles(...)`** por rota ou no controller; sem `@Roles` = qualquer autenticado. O `JwtAuthGuard` já é global.
- **Cifra:** `import { encrypt, decrypt } from '../settings/crypto.util.js'` — `encrypt(plain: string): string`, `decrypt(blob: string): string`. Exige `APP_ENCRYPTION_KEY` no ambiente; sem ela, `encrypt` lança `EncryptionKeyMissingError` (já existe).
- **Conventional Commits** + `CHANGELOG.md` (Keep a Changelog) na seção `[Não lançado]` durante o desenvolvimento. Release final = **0.3.0** (MINOR).
- **Status do ativo:** enum `AssetStatus { ACTIVE, MAINTENANCE, INACTIVE }`. Ativo não tem `active` booleano separado; `INACTIVE` some dos seletores.
- **Unicidade de série:** `serialNumber` vazio/`""` deve virar `null` antes de gravar (Postgres permite múltiplos `NULL` no índice composto).
- **Testes de integração:** padrão do repo — `new PrismaClient()`, pula com `console.warn` + exit 0 se `!process.env.DATABASE_URL` ou conexão falhar; prefixo único (`ATL-${Date.now()}`) + `cleanup()` em `beforeAll`. Config: `vitest.config.integration.ts`, script `npm run test:integration`.

---

## Task 1: Schema Prisma — modelos e migração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_assets_locations/migration.sql` (gerada pelo prisma)

**Interfaces:**
- Produces: modelos `Location`, `AssetType`, `Asset` + enum `AssetStatus`; `Ticket.locationId String?` + relação M-N `Ticket.assets` ↔ `Asset.tickets` (`@relation("TicketAssets")`); `Attachment.assetId String?`; `TicketEventType` += `LOCATION_CHANGED`, `ASSETS_CHANGED`. `Client` ganha `locations Location[]` e `assets Asset[]`.

- [ ] **Step 1: Editar `schema.prisma` — enum novo**

Depois do enum `TicketOrigin`, adicionar:

```prisma
enum AssetStatus {
  ACTIVE
  MAINTENANCE
  INACTIVE
}
```

- [ ] **Step 2: Editar `schema.prisma` — `TicketEventType`**

Adicionar dois valores ao enum existente:

```prisma
enum TicketEventType {
  CREATED
  STATUS_CHANGED
  ASSIGNED
  PRIORITY_CHANGED
  COMMENT
  EMAIL_IN
  EMAIL_OUT
  LOCATION_CHANGED
  ASSETS_CHANGED
}
```

- [ ] **Step 3: Editar `schema.prisma` — modelos novos**

Adicionar após o modelo `Category`:

```prisma
model Location {
  id           String   @id @default(cuid())
  clientId     String
  name         String
  address      String?
  contactName  String?
  contactPhone String?
  accessNotes  String?
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  client Client  @relation(fields: [clientId], references: [id])
  assets Asset[]
  tickets Ticket[]

  @@unique([clientId, name])
  @@index([clientId])
  @@map("locations")
}

model AssetType {
  id        String   @id @default(cuid())
  name      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  assets Asset[]

  @@map("asset_types")
}

model Asset {
  id             String      @id @default(cuid())
  clientId       String
  locationId     String
  typeId         String
  label          String
  brand          String?
  model          String?
  serialNumber   String?
  ip             String?
  mac            String?
  credentialsEnc String?
  installedAt    DateTime?
  warrantyEndsAt DateTime?
  status         AssetStatus @default(ACTIVE)
  notes          String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  client      Client       @relation(fields: [clientId], references: [id])
  location    Location     @relation(fields: [locationId], references: [id])
  type        AssetType    @relation(fields: [typeId], references: [id])
  tickets     Ticket[]     @relation("TicketAssets")
  attachments Attachment[]

  @@unique([clientId, serialNumber])
  @@index([clientId])
  @@index([locationId])
  @@index([typeId])
  @@map("assets")
}
```

- [ ] **Step 4: Editar `schema.prisma` — `Client`, `Ticket`, `Attachment`**

No `model Client`, adicionar às relações:

```prisma
  locations Location[]
  assets    Asset[]
```

No `model Ticket`, adicionar campo + relações + índice:

```prisma
  locationId String?
  ...
  location Location? @relation(fields: [locationId], references: [id])
  assets   Asset[]   @relation("TicketAssets")
  ...
  @@index([locationId])
```

(Manter a coluna `equipment String?` como está — legado.)

No `model Attachment`, adicionar:

```prisma
  assetId String?
  ...
  asset Asset? @relation(fields: [assetId], references: [id], onDelete: Cascade)
  ...
  @@index([assetId])
```

- [ ] **Step 5: Validar e gerar a migração**

Rodar em `C:/Users/renan/os-exec/backend`:

```bash
npx prisma validate
npx prisma migrate dev --name add_assets_locations
npx prisma generate
```

Expected: `validate` OK; migração criada e aplicada sem erro; client regenerado.

- [ ] **Step 6: Build de sanidade**

Run: `npm run build`
Expected: `nest build` compila sem erro de tipo (o `@prisma/client` novo já tem `Location`, `Asset`, `AssetType`).

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(assets): schema de locais, tipos de ativo e ativos"
```

---

## Task 2: Módulo `asset-types`

**Files:**
- Create: `backend/src/asset-types/asset-types.module.ts`
- Create: `backend/src/asset-types/asset-types.service.ts`
- Create: `backend/src/asset-types/asset-types.controller.ts`
- Create: `backend/src/asset-types/dto/create-asset-type.dto.ts`
- Create: `backend/src/asset-types/dto/update-asset-type.dto.ts`
- Create: `backend/src/asset-types/asset-types.service.spec.ts`
- Modify: `backend/src/app.module.ts` (registrar `AssetTypesModule`)

**Interfaces:**
- Consumes: `PrismaService` de `../prisma/prisma.service.js`.
- Produces: `AssetTypesService` com `create(dto)`, `findAll()`, `update(id, dto)`, e `onModuleInit()` que faz seed idempotente. Exportado pelo módulo.

- [ ] **Step 1: Escrever o teste que falha**

`backend/src/asset-types/asset-types.service.spec.ts`:

```ts
import { AssetTypesService } from './asset-types.service.js';

const makePrisma = () => ({
  assetType: {
    findMany: vi.fn().mockResolvedValue([]),
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera' }),
    findUnique: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera' }),
    update: vi.fn().mockResolvedValue({ id: 't1', name: 'Câmera IP' }),
  },
});

describe('AssetTypesService', () => {
  it('seed usa createMany com skipDuplicates e a lista padrão', async () => {
    const prisma = makePrisma();
    const service = new AssetTypesService(prisma as any);
    await service.onModuleInit();
    const arg = prisma.assetType.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual(
      expect.arrayContaining([{ name: 'Câmera' }, { name: 'DVR/NVR' }, { name: 'Controladora de acesso' }]),
    );
  });

  it('findAll ordena por name asc', async () => {
    const prisma = makePrisma();
    const service = new AssetTypesService(prisma as any);
    await service.findAll();
    expect(prisma.assetType.findMany).toHaveBeenCalledWith({ orderBy: { name: 'asc' } });
  });

  it('update lança NotFound quando o tipo não existe', async () => {
    const prisma = makePrisma();
    prisma.assetType.findUnique.mockResolvedValue(null);
    const service = new AssetTypesService(prisma as any);
    await expect(service.update('x', { name: 'y' } as any)).rejects.toThrow('Tipo de ativo não encontrado.');
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test -- asset-types`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: DTOs**

`backend/src/asset-types/dto/create-asset-type.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class CreateAssetTypeDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
```

`backend/src/asset-types/dto/update-asset-type.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAssetTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
```

- [ ] **Step 4: Service**

`backend/src/asset-types/asset-types.service.ts`:

```ts
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAssetTypeDto } from './dto/create-asset-type.dto.js';
import { UpdateAssetTypeDto } from './dto/update-asset-type.dto.js';

const SEED = [
  'Câmera',
  'DVR/NVR',
  'Switch',
  'Roteador',
  'No-break',
  'Servidor',
  'Desktop',
  'Central de alarme',
  'Controladora de acesso',
  'Cerca elétrica',
  'Catraca',
  'Fechadura eletrônica',
];

@Injectable()
export class AssetTypesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.assetType.createMany({
      data: SEED.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  create(dto: CreateAssetTypeDto) {
    return this.prisma.assetType.create({ data: { name: dto.name } });
  }

  /** Todos (ativos e inativos): a config da equipe precisa dos inativos para reativar. */
  findAll() {
    return this.prisma.assetType.findMany({ orderBy: { name: 'asc' } });
  }

  async update(id: string, dto: UpdateAssetTypeDto) {
    const found = await this.prisma.assetType.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Tipo de ativo não encontrado.');
    return this.prisma.assetType.update({ where: { id }, data: dto });
  }
}
```

- [ ] **Step 5: Controller**

`backend/src/asset-types/asset-types.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AssetTypesService } from './asset-types.service.js';
import { CreateAssetTypeDto } from './dto/create-asset-type.dto.js';
import { UpdateAssetTypeDto } from './dto/update-asset-type.dto.js';

@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly assetTypes: AssetTypesService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateAssetTypeDto) {
    return this.assetTypes.create(dto);
  }

  // Qualquer autenticado interno: forms de ativo e a aba de config precisam listar.
  @Get()
  findAll() {
    return this.assetTypes.findAll();
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAssetTypeDto) {
    return this.assetTypes.update(id, dto);
  }
}
```

- [ ] **Step 6: Module + registro**

`backend/src/asset-types/asset-types.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AssetTypesService } from './asset-types.service.js';
import { AssetTypesController } from './asset-types.controller.js';

@Module({
  providers: [AssetTypesService],
  controllers: [AssetTypesController],
  exports: [AssetTypesService],
})
export class AssetTypesModule {}
```

Em `backend/src/app.module.ts`: importar `AssetTypesModule` e adicioná-lo ao array `imports` (logo após `CategoriesModule`).

- [ ] **Step 7: Rodar testes**

Run: `npm test -- asset-types`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/asset-types backend/src/app.module.ts
git commit -m "feat(assets): módulo asset-types com seed configurável"
```

---

## Task 3: Módulo `locations`

**Files:**
- Create: `backend/src/locations/locations.module.ts`
- Create: `backend/src/locations/locations.service.ts`
- Create: `backend/src/locations/locations.controller.ts`
- Create: `backend/src/locations/dto/create-location.dto.ts`
- Create: `backend/src/locations/dto/update-location.dto.ts`
- Create: `backend/src/locations/locations.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`; `PaginationDto` de `../common/pagination.dto.js`.
- Produces: `LocationsService` com `create(dto)`, `findAll(clientId?, pagination)`, `findOne(id)`, `update(id, dto)`. `create`/`update` validam cliente ativo e traduzem colisão `@@unique([clientId,name])` em `ConflictException`.

- [ ] **Step 1: Teste que falha**

`backend/src/locations/locations.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { LocationsService } from './locations.service.js';

const makePrisma = () => ({
  client: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', active: true }) },
  location: {
    create: vi.fn().mockResolvedValue({ id: 'l1' }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue({ id: 'l1', clientId: 'c1' }),
    update: vi.fn().mockResolvedValue({ id: 'l1' }),
  },
});

describe('LocationsService', () => {
  it('create rejeita cliente inexistente', async () => {
    const prisma = makePrisma();
    prisma.client.findUnique.mockResolvedValue(null);
    const s = new LocationsService(prisma as any);
    await expect(s.create({ clientId: 'x', name: 'Matriz' } as any)).rejects.toThrow(
      'Cliente inválido ou inativo.',
    );
  });

  it('create traduz P2002 em ConflictException', async () => {
    const prisma = makePrisma();
    prisma.location.create.mockRejectedValue({ code: 'P2002' });
    const s = new LocationsService(prisma as any);
    await expect(s.create({ clientId: 'c1', name: 'Matriz' } as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('findAll filtra por clientId e q, com envelope paginado', async () => {
    const prisma = makePrisma();
    prisma.location.findMany.mockResolvedValue([{ id: 'l1' }]);
    prisma.location.count.mockResolvedValue(1);
    const s = new LocationsService(prisma as any);
    const out = await s.findAll('c1', { page: 1, pageSize: 20, q: 'loja' } as any);
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'c1', name: { contains: 'loja', mode: 'insensitive' } },
        skip: 0,
        take: 20,
      }),
    );
    expect(out).toEqual({ data: [{ id: 'l1' }], total: 1, page: 1, pageSize: 20 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- locations`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: DTOs**

`backend/src/locations/dto/create-location.dto.ts`:

```ts
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateLocationDto {
  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() accessNotes?: string;
}
```

`backend/src/locations/dto/update-location.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateLocationDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsString() accessNotes?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 4: Service**

`backend/src/locations/locations.service.ts`:

```ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertClient(clientId: string) {
    const client = await this.prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.active === false) {
      throw new ConflictException('Cliente inválido ou inativo.');
    }
  }

  async create(dto: CreateLocationDto) {
    await this.assertClient(dto.clientId);
    try {
      return await this.prisma.location.create({
        data: {
          clientId: dto.clientId,
          name: dto.name,
          address: dto.address ?? null,
          contactName: dto.contactName ?? null,
          contactPhone: dto.contactPhone ?? null,
          accessNotes: dto.accessNotes ?? null,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Já existe um local com esse nome para o cliente.');
      }
      throw e;
    }
  }

  async findAll(clientId: string | undefined, { page = 1, pageSize = 20, q }: PaginationDto) {
    const where: Prisma.LocationWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (q) where.name = { contains: q, mode: 'insensitive' };
    const [data, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.location.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  async findOne(id: string) {
    const location = await this.prisma.location.findUnique({ where: { id } });
    if (!location) throw new NotFoundException('Local não encontrado.');
    return location;
  }

  async update(id: string, dto: UpdateLocationDto) {
    await this.findOne(id);
    try {
      return await this.prisma.location.update({ where: { id }, data: dto });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new ConflictException('Já existe um local com esse nome para o cliente.');
      }
      throw e;
    }
  }
}
```

- [ ] **Step 5: Controller**

`backend/src/locations/locations.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { LocationsService } from './locations.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';

@Controller('locations')
@Roles('ADMIN', 'AGENT')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Get()
  findAll(@Query('clientId') clientId: string | undefined, @Query() query: PaginationDto) {
    return this.locations.findAll(clientId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locations.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto);
  }
}
```

- [ ] **Step 6: Module + registro**

`backend/src/locations/locations.module.ts` (padrão de `clients.module.ts`, exporta `LocationsService`). Registrar `LocationsModule` em `app.module.ts` após `AssetTypesModule`.

- [ ] **Step 7: Rodar testes**

Run: `npm test -- locations`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/locations backend/src/app.module.ts
git commit -m "feat(assets): módulo locations (locais por cliente)"
```

---

## Task 4: Módulo `assets` — CRUD, credenciais e histórico

**Files:**
- Create: `backend/src/assets/assets.module.ts`
- Create: `backend/src/assets/assets.service.ts`
- Create: `backend/src/assets/assets.controller.ts`
- Create: `backend/src/assets/dto/create-asset.dto.ts`
- Create: `backend/src/assets/dto/update-asset.dto.ts`
- Create: `backend/src/assets/dto/list-assets.dto.ts`
- Create: `backend/src/assets/assets.serializer.ts`
- Create: `backend/src/assets/assets.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `PrismaService`; `encrypt`/`decrypt` de `../settings/crypto.util.js`.
- Produces:
  - `serializeAsset(asset)` → tira `credentialsEnc`, adiciona `hasCredentials: boolean`.
  - `AssetsService` com:
    - `create(dto: CreateAssetInput): Promise<SerializedAsset>`
    - `update(id: string, dto: UpdateAssetInput): Promise<SerializedAsset>`
    - `findAll(filter: ListAssetsFilter): Promise<{data,total,page,pageSize}>` (itens serializados)
    - `findOne(id: string): Promise<SerializedAsset & { client, location, type, recentTickets }>`
    - `revealCredentials(id: string): Promise<{ username: string | null; password: string | null }>`
  - Exportado pelo módulo (usado depois pelo `assets-import` e `attachments`).

- [ ] **Step 1: Teste que falha**

`backend/src/assets/assets.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service.js';
import * as crypto from '../settings/crypto.util.js';

const baseLocation = { id: 'l1', clientId: 'c1' };
const makePrisma = () => ({
  location: { findUnique: vi.fn().mockResolvedValue(baseLocation) },
  assetType: { findUnique: vi.fn().mockResolvedValue({ id: 't1', active: true }) },
  asset: {
    create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    findUnique: vi.fn().mockResolvedValue({
      id: 'a1', clientId: 'c1', locationId: 'l1', credentialsEnc: null,
    }),
    update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  },
  ticket: { findMany: vi.fn().mockResolvedValue([]) },
});

describe('AssetsService', () => {
  it('create exige que o local pertença ao cliente', async () => {
    const prisma = makePrisma();
    prisma.location.findUnique.mockResolvedValue({ id: 'l1', clientId: 'OUTRO' });
    const s = new AssetsService(prisma as any);
    await expect(
      s.create({ clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'CAM-01' } as any),
    ).rejects.toThrow('O local informado não pertence ao cliente.');
  });

  it('create cifra credenciais e nunca devolve o segredo', async () => {
    const prisma = makePrisma();
    vi.spyOn(crypto, 'encrypt').mockReturnValue('BLOB');
    const s = new AssetsService(prisma as any);
    const out = await s.create({
      clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'CAM-01',
      credentials: { username: 'admin', password: '1234' },
    } as any);
    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ credentialsEnc: 'BLOB' }) }),
    );
    expect(out).not.toHaveProperty('credentialsEnc');
    expect(out.hasCredentials).toBe(true);
  });

  it('serialNumber vazio vira null', async () => {
    const prisma = makePrisma();
    const s = new AssetsService(prisma as any);
    await s.create({ clientId: 'c1', locationId: 'l1', typeId: 't1', label: 'X', serialNumber: '' } as any);
    expect(prisma.asset.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ serialNumber: null }) }),
    );
  });

  it('revealCredentials decifra o blob quando existe', async () => {
    const prisma = makePrisma();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', credentialsEnc: 'BLOB' });
    vi.spyOn(crypto, 'decrypt').mockReturnValue('{"username":"admin","password":"1234"}');
    const s = new AssetsService(prisma as any);
    expect(await s.revealCredentials('a1')).toEqual({ username: 'admin', password: '1234' });
  });

  it('revealCredentials devolve nulos quando não há credencial', async () => {
    const prisma = makePrisma();
    prisma.asset.findUnique.mockResolvedValue({ id: 'a1', credentialsEnc: null });
    const s = new AssetsService(prisma as any);
    expect(await s.revealCredentials('a1')).toEqual({ username: null, password: null });
  });

  it('findAll aplica filtros e serializa (sem credentialsEnc)', async () => {
    const prisma = makePrisma();
    prisma.asset.findMany.mockResolvedValue([{ id: 'a1', credentialsEnc: 'BLOB' }]);
    prisma.asset.count.mockResolvedValue(1);
    const s = new AssetsService(prisma as any);
    const out = await s.findAll({ clientId: 'c1', status: 'ACTIVE', page: 1, pageSize: 20 } as any);
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ clientId: 'c1', status: 'ACTIVE' }) }),
    );
    expect(out.data[0]).not.toHaveProperty('credentialsEnc');
    expect(out.data[0].hasCredentials).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- assets.service`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Serializer**

`backend/src/assets/assets.serializer.ts`:

```ts
import type { Asset } from '@prisma/client';

export type SerializedAsset = Omit<Asset, 'credentialsEnc'> & { hasCredentials: boolean };

/** Nunca deixa `credentialsEnc` sair da API; expõe só o booleano. */
export function serializeAsset<T extends { credentialsEnc: string | null }>(
  asset: T,
): Omit<T, 'credentialsEnc'> & { hasCredentials: boolean } {
  const { credentialsEnc, ...rest } = asset;
  return { ...rest, hasCredentials: credentialsEnc != null };
}
```

- [ ] **Step 4: DTOs**

`backend/src/assets/dto/create-asset.dto.ts`:

```ts
import { Type } from 'class-transformer';
import {
  IsIn, IsISO8601, IsOptional, IsString, MinLength, ValidateNested,
} from 'class-validator';

export class CredentialsDto {
  @IsString() @MinLength(1) username!: string;
  @IsString() @MinLength(1) password!: string;
}

export class CreateAssetDto {
  @IsString() @MinLength(1) clientId!: string;
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) typeId!: string;
  @IsString() @MinLength(1) label!: string;

  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsString() mac?: string;

  // `null` limpa; objeto grava; ausência mantém (no update).
  @IsOptional() @ValidateNested() @Type(() => CredentialsDto)
  credentials?: CredentialsDto | null;

  @IsOptional() @IsISO8601() installedAt?: string;
  @IsOptional() @IsISO8601() warrantyEndsAt?: string;

  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
  @IsOptional() @IsString() notes?: string;
}
```

`backend/src/assets/dto/update-asset.dto.ts`:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateAssetDto } from './create-asset.dto.js';

// `clientId`/`locationId`/`typeId`/`label` também opcionais no update.
export class UpdateAssetDto extends PartialType(CreateAssetDto) {}
```

> Se `@nestjs/mapped-types` não estiver instalado, repetir os campos como `@IsOptional()` à mão (não adicionar dependência por isso). Conferir com `grep mapped-types backend/package.json`.

`backend/src/assets/dto/list-assets.dto.ts`:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto.js';

export class ListAssetsDto extends PaginationDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() typeId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'MAINTENANCE', 'INACTIVE']) status?: 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';
}
```

- [ ] **Step 5: Service**

`backend/src/assets/assets.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt, encrypt } from '../settings/crypto.util.js';
import { serializeAsset } from './assets.serializer.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

type WriteData = Prisma.AssetUncheckedCreateInput;

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Valida local⊂cliente e tipo ativo; devolve os campos comuns já normalizados. */
  private async buildWrite(dto: CreateAssetDto | UpdateAssetDto, current?: { clientId: string }) {
    const data: Partial<WriteData> = {};
    if (dto.clientId !== undefined) data.clientId = dto.clientId;
    if (dto.locationId !== undefined) data.locationId = dto.locationId;
    if (dto.typeId !== undefined) data.typeId = dto.typeId;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.brand !== undefined) data.brand = dto.brand || null;
    if (dto.model !== undefined) data.model = dto.model || null;
    if (dto.serialNumber !== undefined) data.serialNumber = dto.serialNumber?.trim() || null;
    if (dto.ip !== undefined) data.ip = dto.ip || null;
    if (dto.mac !== undefined) data.mac = dto.mac || null;
    if (dto.notes !== undefined) data.notes = dto.notes || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.installedAt !== undefined) data.installedAt = dto.installedAt ? new Date(dto.installedAt) : null;
    if (dto.warrantyEndsAt !== undefined) data.warrantyEndsAt = dto.warrantyEndsAt ? new Date(dto.warrantyEndsAt) : null;
    if (dto.credentials !== undefined) {
      data.credentialsEnc = dto.credentials
        ? encrypt(JSON.stringify({ username: dto.credentials.username, password: dto.credentials.password }))
        : null;
    }

    const clientId = data.clientId ?? current?.clientId;
    const locationId = data.locationId;
    if (locationId && clientId) {
      const loc = await this.prisma.location.findUnique({ where: { id: locationId } });
      if (!loc) throw new BadRequestException('Local não encontrado.');
      if (loc.clientId !== clientId) {
        throw new BadRequestException('O local informado não pertence ao cliente.');
      }
    }
    if (data.typeId) {
      const t = await this.prisma.assetType.findUnique({ where: { id: data.typeId } });
      if (!t) throw new BadRequestException('Tipo de ativo não encontrado.');
    }
    return data;
  }

  async create(dto: CreateAssetDto) {
    const data = await this.buildWrite(dto);
    try {
      const created = await this.prisma.asset.create({ data: data as WriteData });
      return serializeAsset(created);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Já existe um ativo com esse número de série para o cliente.');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateAssetDto) {
    const current = await this.prisma.asset.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Ativo não encontrado.');
    const data = await this.buildWrite(dto, current);
    try {
      const updated = await this.prisma.asset.update({ where: { id }, data });
      return serializeAsset(updated);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Já existe um ativo com esse número de série para o cliente.');
      }
      throw e;
    }
  }

  async findAll(filter: ListAssetsDto) {
    const { page = 1, pageSize = 20, q, clientId, locationId, typeId, status } = filter;
    const where: Prisma.AssetWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (locationId) where.locationId = locationId;
    if (typeId) where.typeId = typeId;
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { label: { contains: q, mode: 'insensitive' } },
        { serialNumber: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { model: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { label: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { location: { select: { id: true, name: true } }, type: { select: { id: true, name: true } }, client: { select: { id: true, name: true } } },
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { data: rows.map(serializeAsset), total, page, pageSize };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { client: true, location: true, type: true },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    const recentTickets = await this.prisma.ticket.findMany({
      where: { assets: { some: { id } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, number: true, title: true, status: true, createdAt: true,
        assignee: { select: { id: true, name: true } },
      },
    });
    return { ...serializeAsset(asset), recentTickets };
  }

  async revealCredentials(id: string): Promise<{ username: string | null; password: string | null }> {
    const asset = await this.prisma.asset.findUnique({ where: { id }, select: { credentialsEnc: true } });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    if (!asset.credentialsEnc) return { username: null, password: null };
    const parsed = JSON.parse(decrypt(asset.credentialsEnc)) as { username: string; password: string };
    return { username: parsed.username ?? null, password: parsed.password ?? null };
  }
}
```

- [ ] **Step 6: Controller**

`backend/src/assets/assets.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AssetsService } from './assets.service.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

@Controller('assets')
@Roles('ADMIN', 'AGENT')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.assets.create(dto);
  }

  @Get()
  findAll(@Query() query: ListAssetsDto) {
    return this.assets.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assets.findOne(id);
  }

  @Get(':id/credentials')
  reveal(@Param('id') id: string) {
    return this.assets.revealCredentials(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(id, dto);
  }
}
```

- [ ] **Step 7: Module + registro**

`backend/src/assets/assets.module.ts` (padrão; `exports: [AssetsService]`). Registrar `AssetsModule` em `app.module.ts` após `LocationsModule`.

- [ ] **Step 8: Rodar testes + build**

Run: `npm test -- assets.service && npm run build`
Expected: PASS + build OK.

- [ ] **Step 9: Commit**

```bash
git add backend/src/assets backend/src/app.module.ts
git commit -m "feat(assets): CRUD de ativos com credenciais cifradas e histórico"
```

---

## Task 5: Fotos de ativo (anexos)

**Files:**
- Modify: `backend/src/attachments/attachments.service.ts` (novo método `saveForAsset` + branch `assetId` em `getForDownload`)
- Modify: `backend/src/attachments/attachments.controller.ts` (rotas `POST/GET /assets/:id/attachments`)
- Modify: `backend/src/attachments/attachments.module.ts` (importar `AssetsModule` se precisar do service; ou usar `PrismaService` direto)
- Modify: `backend/src/attachments/attachments.service.spec.ts` (ou criar caso não exista) — cobrir `saveForAsset`
- Test: `backend/src/attachments/attachments.controller.spec.ts` (ajustar mocks)

**Interfaces:**
- Consumes: `PrismaService`, `StorageService`, `serializeAsset` não é necessário aqui.
- Produces: `AttachmentsService.saveForAsset(assetId: string, file: UploadedFile, actor: Actor)` → `publicAttachment`. `listForAsset(assetId: string)` → `publicAttachment[]`. `getForDownload` passa a resolver anexo com `assetId` (acesso: só `INTERNAL`).

- [ ] **Step 1: Teste que falha**

Adicionar em `backend/src/attachments/attachments.service.spec.ts`:

```ts
describe('AttachmentsService.saveForAsset', () => {
  it('rejeita ativo inexistente', async () => {
    // prisma.asset.findUnique -> null
    // espera NotFoundException('Ativo não encontrado.')
  });
  it('persiste o anexo com assetId e devolve publicAttachment', async () => {
    // prisma.asset.findUnique -> { id: 'a1' }
    // storage.put chamado; prisma.attachment.create com data.assetId = 'a1'
  });
});

describe('AttachmentsService.getForDownload (asset)', () => {
  it('CLIENT não baixa anexo de ativo (NotFound)', async () => {
    // attachment { assetId: 'a1', ticketId: null, commentId: null }
    // actor.type === 'CLIENT' -> NotFoundException
  });
});
```

Preencher os mocks seguindo o estilo já presente no arquivo (`makePrisma`, `vi.fn()`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- attachments`
Expected: FAIL.

- [ ] **Step 3: `saveForAsset` + `listForAsset` no service**

Em `attachments.service.ts`, adicionar (usa `this.prisma` já injetado; não precisa do `AssetsService`):

```ts
async saveForAsset(
  assetId: string,
  file: UploadedFile,
  actor: Actor,
): Promise<ReturnType<typeof publicAttachment>> {
  const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw new NotFoundException('Ativo não encontrado.');
  return publicAttachment(await this.persist({ assetId }, file, actor));
}

listForAsset(assetId: string) {
  return this.prisma.attachment
    .findMany({ where: { assetId }, orderBy: { createdAt: 'asc' } })
    .then((rows) => rows.map(publicAttachment));
}
```

Ampliar a assinatura de `persist` para aceitar `{ assetId: string }`:

```ts
private async persist(
  link: { ticketId: string } | { commentId: string } | { assetId: string },
  file: UploadedFile,
  actor?: Actor,
): Promise<Attachment> { /* corpo inalterado */ }
```

Em `getForDownload`, antes do bloco `if (!ticketId) throw ...`, adicionar:

```ts
// Anexo de ativo: recurso interno. Cliente nunca baixa.
if (!ticketId && !attachment.commentId && attachment.assetId) {
  if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
  return attachment;
}
```

- [ ] **Step 4: Rotas no controller**

Em `attachments.controller.ts`, adicionar (o `interceptor` e o filtro de multer já existem no arquivo):

```ts
@Post('assets/:id/attachments')
@Roles('ADMIN', 'AGENT')
@UseInterceptors(interceptor)
uploadToAsset(
  @Param('id') id: string,
  @UploadedFile() file: UF,
  @CurrentUser() actor: CurrentUserData,
) {
  return this.attachments.saveForAsset(id, file, actor);
}

@Get('assets/:id/attachments')
@Roles('ADMIN', 'AGENT')
listForAsset(@Param('id') id: string) {
  return this.attachments.listForAsset(id);
}
```

Importar `Roles` de `../common/roles.decorator.js` no controller.

- [ ] **Step 5: Rodar testes + build**

Run: `npm test -- attachments && npm run build`
Expected: PASS + build OK.

- [ ] **Step 6: Commit**

```bash
git add backend/src/attachments
git commit -m "feat(assets): upload e listagem de fotos do ativo"
```

---

## Task 6: Importação CSV de ativos

**Files:**
- Modify: `backend/package.json` (dependência `csv-parse`)
- Create: `backend/src/assets/assets-import.service.ts`
- Create: `backend/src/assets/dto/import-result.dto.ts`
- Modify: `backend/src/assets/assets.controller.ts` (rota `POST /assets/import`)
- Modify: `backend/src/assets/assets.module.ts` (provider `AssetsImportService`)
- Create: `backend/src/assets/assets-import.service.spec.ts`
- Create: `frontend/public/modelo-ativos.csv`

**Interfaces:**
- Consumes: `PrismaService`.
- Produces: `AssetsImportService.import(buffer: Buffer): Promise<ImportResult>` onde `ImportResult = { created: number; errors: { line: number; message: string }[] }`.

- [ ] **Step 1: Instalar `csv-parse`**

Run em `C:/Users/renan/os-exec/backend`: `npm install csv-parse`
Expected: entra em `dependencies`.

- [ ] **Step 2: Teste que falha**

`backend/src/assets/assets-import.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { AssetsImportService } from './assets-import.service.js';

const HEADER = 'cliente,local,tipo,identificacao,marca,modelo,numero_serie,ip,mac,instalado_em,garantia_ate,observacoes';

const makePrisma = () => ({
  client: { findFirst: vi.fn() },
  location: { findFirst: vi.fn() },
  assetType: { findFirst: vi.fn() },
  asset: { create: vi.fn().mockResolvedValue({ id: 'a1' }) },
  $transaction: vi.fn((fn: any) => fn(makeTx())),
});
const makeTx = () => ({ asset: { create: vi.fn().mockResolvedValue({ id: 'a1' }) } });

const buf = (s: string) => Buffer.from(s, 'utf8');

describe('AssetsImportService', () => {
  it('cabeçalho ausente -> BadRequest do arquivo todo', async () => {
    const s = new AssetsImportService(makePrisma() as any);
    await expect(s.import(buf('foo,bar\n1,2'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('linha com cliente inexistente vira erro, não cria', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue(null);
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,,,,,,,,`));
    expect(out.created).toBe(0);
    expect(out.errors[0]).toEqual({ line: 2, message: expect.stringContaining('Cliente') });
  });

  it('linha boa cria o ativo (status ACTIVE)', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.location.findFirst.mockResolvedValue({ id: 'l1', clientId: 'c1' });
    prisma.assetType.findFirst.mockResolvedValue({ id: 't1' });
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,Intelbras,VIP,SN123,10.0.0.5,,2024-01-10,2026-01-10,porta`));
    expect(out).toEqual({ created: 1, errors: [] });
  });

  it('data inválida vira erro na linha', async () => {
    const prisma = makePrisma();
    prisma.client.findFirst.mockResolvedValue({ id: 'c1' });
    prisma.location.findFirst.mockResolvedValue({ id: 'l1', clientId: 'c1' });
    prisma.assetType.findFirst.mockResolvedValue({ id: 't1' });
    const s = new AssetsImportService(prisma as any);
    const out = await s.import(buf(`${HEADER}\nACME,Matriz,Câmera,CAM-01,,,,,,10/01/2024,,`));
    expect(out.created).toBe(0);
    expect(out.errors[0].message).toContain('Data');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -- assets-import`
Expected: FAIL — service não existe.

- [ ] **Step 4: `ImportResult` DTO**

`backend/src/assets/dto/import-result.dto.ts`:

```ts
export interface ImportRowError {
  line: number;
  message: string;
}
export interface ImportResult {
  created: number;
  errors: ImportRowError[];
}
```

- [ ] **Step 5: Service**

`backend/src/assets/assets-import.service.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ImportResult, ImportRowError } from './dto/import-result.dto.js';

const COLUMNS = [
  'cliente', 'local', 'tipo', 'identificacao', 'marca', 'modelo',
  'numero_serie', 'ip', 'mac', 'instalado_em', 'garantia_ate', 'observacoes',
];

type Row = Record<(typeof COLUMNS)[number], string>;

/** `YYYY-MM-DD` → Date; qualquer outra coisa → null com flag de erro. */
function parseDate(raw: string): { date: Date | null; bad: boolean } {
  const v = raw?.trim();
  if (!v) return { date: null, bad: false };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: null, bad: true };
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? { date: null, bad: true } : { date: d, bad: false };
}

@Injectable()
export class AssetsImportService {
  constructor(private readonly prisma: PrismaService) {}

  async import(buffer: Buffer): Promise<ImportResult> {
    let records: Row[];
    try {
      records = parse(buffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      });
    } catch {
      throw new BadRequestException('CSV inválido: não foi possível ler o arquivo.');
    }
    if (records.length === 0) {
      throw new BadRequestException('CSV vazio ou sem linhas de dados.');
    }
    const present = Object.keys(records[0]);
    const missing = COLUMNS.filter((c) => !present.includes(c));
    if (missing.length) {
      throw new BadRequestException(`CSV sem as colunas obrigatórias: ${missing.join(', ')}.`);
    }

    const errors: ImportRowError[] = [];
    let created = 0;

    for (let i = 0; i < records.length; i++) {
      const line = i + 2; // +1 header, +1 base-1
      const row = records[i];
      try {
        const client = await this.prisma.client.findFirst({
          where: { name: row.cliente?.trim(), active: true },
        });
        if (!client) throw new Error(`Cliente "${row.cliente}" não encontrado.`);

        const location = await this.prisma.location.findFirst({
          where: { clientId: client.id, name: row.local?.trim() },
        });
        if (!location) throw new Error(`Local "${row.local}" não encontrado para o cliente.`);

        const type = await this.prisma.assetType.findFirst({
          where: { name: row.tipo?.trim(), active: true },
        });
        if (!type) throw new Error(`Tipo "${row.tipo}" não encontrado.`);

        if (!row.identificacao?.trim()) throw new Error('Identificação obrigatória.');

        const serial = row.numero_serie?.trim() || null;
        if (serial) {
          const dup = await this.prisma.asset.findFirst({
            where: { clientId: client.id, serialNumber: serial },
          });
          if (dup) throw new Error(`Número de série "${serial}" já cadastrado para o cliente.`);
        }

        const inst = parseDate(row.instalado_em);
        const warr = parseDate(row.garantia_ate);
        if (inst.bad) throw new Error('Data de instalação inválida (use YYYY-MM-DD).');
        if (warr.bad) throw new Error('Data de garantia inválida (use YYYY-MM-DD).');

        await this.prisma.$transaction((tx) =>
          tx.asset.create({
            data: {
              clientId: client.id,
              locationId: location.id,
              typeId: type.id,
              label: row.identificacao.trim(),
              brand: row.marca?.trim() || null,
              model: row.modelo?.trim() || null,
              serialNumber: serial,
              ip: row.ip?.trim() || null,
              mac: row.mac?.trim() || null,
              installedAt: inst.date,
              warrantyEndsAt: warr.date,
              notes: row.observacoes?.trim() || null,
              status: 'ACTIVE',
            },
          }),
        );
        created++;
      } catch (e) {
        errors.push({ line, message: (e as Error).message });
      }
    }
    return { created, errors };
  }
}
```

- [ ] **Step 6: Rota + module**

Em `assets.controller.ts`:

```ts
import {
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { UploadedFile as UF } from '../attachments/storage.util.js';
import { AssetsImportService } from './assets-import.service.js';
// ...injetar no constructor: private readonly importer: AssetsImportService

@Post('import')
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
importCsv(@UploadedFile() file: UF) {
  if (!file) throw new BadRequestException('Arquivo ausente.');
  return this.importer.import(file.buffer);
}
```

(`BadRequestException` já importado ou importar de `@nestjs/common`.)

Em `assets.module.ts`: adicionar `AssetsImportService` a `providers`.

- [ ] **Step 7: Modelo CSV estático**

`frontend/public/modelo-ativos.csv`:

```csv
cliente,local,tipo,identificacao,marca,modelo,numero_serie,ip,mac,instalado_em,garantia_ate,observacoes
ACME Ltda,Matriz,Câmera,CAM-01 Portaria,Intelbras,VIP 1230,SN0001,10.0.0.11,,2024-03-10,2026-03-10,foco no portão
ACME Ltda,Matriz,DVR/NVR,DVR-01 Rack,Intelbras,MHDX 1132,SN0002,10.0.0.10,,2024-03-10,2026-03-10,
```

- [ ] **Step 8: Rodar testes + build**

Run: `npm test -- assets-import && npm run build`
Expected: PASS + build OK.

- [ ] **Step 9: Commit**

```bash
git add backend/src/assets backend/package.json backend/package-lock.json frontend/public/modelo-ativos.csv
git commit -m "feat(assets): importação de ativos por CSV"
```

---

## Task 7: Vínculo do chamado a Local + Ativos

**Files:**
- Modify: `backend/src/tickets/dto/create-ticket.dto.ts` (remove `equipment`, adiciona `locationId?`, `assetIds?`)
- Create: `backend/src/tickets/dto/set-ticket-assets.dto.ts`
- Modify: `backend/src/tickets/tickets.service.ts` (`CreateTicketInput`, `create`, novo `setTicketAssets`, `findOne` includes)
- Modify: `backend/src/tickets/tickets.controller.ts` (rota `PATCH /:id/assets`)
- Modify: `backend/src/tickets/tickets.service.spec.ts` (ou arquivo de spec de create/mutations) — cobrir validações
- Modify: `docs/superpowers/specs/2026-09-09-ativos-locais-design.md` (§3.2: trocar "UpdateTicketDto" por "PATCH /:id/assets" — a spec assumiu um update genérico que o módulo não tem)

**Interfaces:**
- Consumes: `TicketEventsService.record(tx, ticketId, type, data, actorId)`; enum `TicketEventType` com `LOCATION_CHANGED`/`ASSETS_CHANGED`.
- Produces:
  - `CreateTicketInput` ganha `locationId?: string | null`, `assetIds?: string[]`; perde `equipment`.
  - `TicketsService.setTicketAssets(id: string, input: { locationId: string | null; assetIds: string[] }, actor: Actor): Promise<Ticket>`.
  - `validateLocationAndAssets(clientId: string | null, locationId: string | null, assetIds: string[])` (privado) — regra local⊂cliente e ativo⊂local.

- [ ] **Step 1: Teste que falha**

Em `backend/src/tickets/tickets.service.spec.ts` (seguir o `makePrisma`/mocks já usados nos testes de create):

```ts
describe('TicketsService — local e ativos', () => {
  it('create rejeita local de outro cliente', async () => {
    // prisma.location.findUnique -> { id:'l1', clientId:'OUTRO' }
    // create({ ..., clientId:'c1', locationId:'l1' }) -> BadRequest 'não pertence ao cliente'
  });

  it('create rejeita ativo fora do local informado', async () => {
    // location ok (clientId c1); prisma.asset.findMany -> [{ id:'a1', locationId:'OUTRA' }]
    // create({ ..., locationId:'l1', assetIds:['a1'] }) -> BadRequest 'não pertence ao local'
  });

  it('setTicketAssets grava eventos LOCATION_CHANGED e ASSETS_CHANGED', async () => {
    // ticket existe com clientId c1; location e assets válidos
    // espera events.record chamado com 'LOCATION_CHANGED' e 'ASSETS_CHANGED'
  });
});
```

Completar mocks conforme o estilo do arquivo. Adicionar ao `makePrisma` as entradas `location: { findUnique }`, `asset: { findMany }`, e no `ticket` os campos usados.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- tickets.service`
Expected: FAIL.

- [ ] **Step 3: DTOs**

Em `create-ticket.dto.ts`: apagar o bloco `equipment` e adicionar:

```ts
  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  assetIds?: string[];
```

(importar `IsArray` de `class-validator`.)

`backend/src/tickets/dto/set-ticket-assets.dto.ts`:

```ts
import { IsArray, IsOptional, IsString } from 'class-validator';

export class SetTicketAssetsDto {
  // `null` limpa o local (e força assetIds vazio).
  @IsOptional()
  @IsString()
  locationId!: string | null;

  @IsArray()
  @IsString({ each: true })
  assetIds!: string[];
}
```

- [ ] **Step 4: Service — validação compartilhada**

Em `tickets.service.ts`, no `CreateTicketInput` trocar `equipment?: string | null;` por:

```ts
  locationId?: string | null;
  assetIds?: string[];
```

Adicionar método privado:

```ts
/** Regra: local pertence ao cliente do chamado; todo ativo pertence a esse local. */
private async validateLocationAndAssets(
  clientId: string | null,
  locationId: string | null,
  assetIds: string[],
): Promise<void> {
  if (!locationId) {
    if (assetIds.length) {
      throw new BadRequestException('Informe um local antes de vincular ativos.');
    }
    return;
  }
  const location = await this.prisma.location.findUnique({ where: { id: locationId } });
  if (!location) throw new BadRequestException('Local não encontrado.');
  if (clientId && location.clientId !== clientId) {
    throw new BadRequestException('O local não pertence ao cliente do chamado.');
  }
  if (assetIds.length) {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, locationId: true },
    });
    if (assets.length !== assetIds.length) {
      throw new BadRequestException('Um ou mais ativos não existem.');
    }
    const foreign = assets.filter((a) => a.locationId !== locationId);
    if (foreign.length) {
      throw new BadRequestException('Um ou mais ativos não pertencem ao local informado.');
    }
  }
}
```

- [ ] **Step 5: Service — `create`**

No `create`, depois de resolver `clientId`, antes da transação:

```ts
const locationId = input.locationId ?? null;
const assetIds = input.assetIds ?? [];
await this.validateLocationAndAssets(clientId, locationId, assetIds);
```

No `tx.ticket.create({ data: { ... } })`: remover `equipment: input.equipment ?? null,` e adicionar:

```ts
  locationId,
  ...(assetIds.length ? { assets: { connect: assetIds.map((id) => ({ id })) } } : {}),
```

- [ ] **Step 6: Service — `setTicketAssets`**

```ts
async setTicketAssets(
  id: string,
  input: { locationId: string | null; assetIds: string[] },
  actor: Actor,
): Promise<Ticket> {
  const ticket = await this.prisma.ticket.findUnique({
    where: { id },
    include: { assets: { select: { id: true } } },
  });
  if (!ticket) throw new NotFoundException('Chamado não encontrado.');

  const locationId = input.locationId ?? null;
  const assetIds = locationId ? input.assetIds : [];
  await this.validateLocationAndAssets(ticket.clientId, locationId, assetIds);

  const before = ticket.assets.map((a) => a.id).sort();
  const after = [...assetIds].sort();
  const assetsChanged = before.join(',') !== after.join(',');
  const locationChanged = (ticket.locationId ?? null) !== locationId;

  return this.prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id },
      data: { locationId, assets: { set: assetIds.map((aid) => ({ id: aid })) } },
    });
    if (locationChanged) {
      await this.events.record(tx, id, 'LOCATION_CHANGED', { from: ticket.locationId ?? null, to: locationId }, actor.id);
    }
    if (assetsChanged) {
      await this.events.record(tx, id, 'ASSETS_CHANGED', { from: before, to: after }, actor.id);
    }
    return updated;
  });
}
```

- [ ] **Step 7: Service — `findOne` includes**

No `findOne`, no objeto `include`, adicionar:

```ts
    location: true,
    assets: { include: { type: { select: { id: true, name: true } } } },
```

O retorno já espalha `...ticket`, então `location` e `assets` viajam. `equipment` continua no spread (só-leitura no front). Nenhum campo sensível de ativo (`credentialsEnc`) é incluído.

- [ ] **Step 8: Controller — rota**

Em `tickets.controller.ts`:

```ts
import { SetTicketAssetsDto } from './dto/set-ticket-assets.dto.js';

@Patch(':id/assets')
@Roles('ADMIN', 'AGENT')
setAssets(
  @Param('id') id: string,
  @Body() dto: SetTicketAssetsDto,
  @CurrentUser() actor: CurrentUserData,
) {
  return this.tickets.setTicketAssets(id, { locationId: dto.locationId ?? null, assetIds: dto.assetIds }, actor);
}
```

- [ ] **Step 9: Ajustar a spec**

Em `docs/superpowers/specs/2026-09-09-ativos-locais-design.md` §3.2, substituir a linha sobre `UpdateTicketDto` por: *"`create` aceita `locationId?` + `assetIds?`. Alteração pós-criação por `PATCH /tickets/:id/assets` (`SetTicketAssetsDto`), no mesmo estilo das mutations `/status`, `/assign`, `/priority`."*

- [ ] **Step 10: Rodar testes + build**

Run: `npm test -- tickets && npm run build`
Expected: PASS + build OK. (Se algum teste antigo enviava `equipment` no create, ajustar para não enviar.)

- [ ] **Step 11: Commit**

```bash
git add backend/src/tickets docs/superpowers/specs/2026-09-09-ativos-locais-design.md
git commit -m "feat(tickets): vínculo a local e ativos, aposenta campo equipment"
```

---

## Task 8: Frontend — lista e ficha de ativo, import, navegação

**Files:**
- Modify: `frontend/src/components/nav.tsx` (item "Ativos" em `APP_LINKS`)
- Create: `frontend/src/lib/assets.ts` (tipos + helpers)
- Create: `frontend/src/app/app/ativos/page.tsx` (lista + filtros + modal import)
- Create: `frontend/src/app/app/ativos/[id]/page.tsx` (ficha)
- Create: `frontend/src/components/asset-form.tsx` (form reutilizável, molde `client-form.tsx`)
- Create: `frontend/src/components/asset-import-dialog.tsx`

**Interfaces:**
- Consumes: `api<T>` de `@/lib/api`; endpoints `/assets`, `/assets/:id`, `/assets/:id/credentials`, `/assets/:id/attachments`, `/assets/import`, `/asset-types`, `/clients?pageSize=100`, `/locations?clientId=`.
- Produces: tipos `Asset`, `AssetType`, `AssetStatus`, `AssetDetail` em `lib/assets.ts`; rotas `/app/ativos` e `/app/ativos/[id]`.

- [ ] **Step 1: `lib/assets.ts`**

```ts
export type AssetStatus = 'ACTIVE' | 'MAINTENANCE' | 'INACTIVE';

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  ACTIVE: 'Ativo',
  MAINTENANCE: 'Em manutenção',
  INACTIVE: 'Inativo',
};

export interface AssetType { id: string; name: string; active: boolean }

export interface Asset {
  id: string;
  label: string;
  status: AssetStatus;
  serialNumber: string | null;
  brand: string | null;
  model: string | null;
  ip: string | null;
  mac: string | null;
  installedAt: string | null;
  warrantyEndsAt: string | null;
  notes: string | null;
  hasCredentials: boolean;
  client?: { id: string; name: string };
  location?: { id: string; name: string };
  type?: { id: string; name: string };
}

export interface AssetDetail extends Asset {
  clientId: string;
  locationId: string;
  typeId: string;
  recentTickets: {
    id: string; number: string; title: string; status: string;
    createdAt: string; assignee: { id: string; name: string } | null;
  }[];
}
```

- [ ] **Step 2: Nav**

Em `frontend/src/components/nav.tsx`, adicionar em `APP_LINKS` entre `Clientes` e `Configurações`:

```ts
  { href: '/app/ativos', label: 'Ativos' },
```

- [ ] **Step 3: `asset-form.tsx`**

Form controlado (molde `client-form.tsx`), campos: cliente (`Select`, de `/clients?pageSize=100`), local (`Select`, recarrega com `/locations?clientId=<clientId>&pageSize=100`, desabilitado sem cliente), tipo (`Select`, de `/asset-types` filtrando `active`), identificação, marca, modelo, nº série, IP, MAC, instalado em (`<input type="date">`), garantia até (`<input type="date">`), status (`Select` com `ASSET_STATUS_LABELS`), observações (`Textarea`), e um bloco Credenciais: dois `Input` (usuário/senha) — no modo edição começam vazios com legenda "deixe em branco para manter". `onSubmit` devolve o payload pronto (`credentials` só vai se algum dos dois campos foi preenchido).

- [ ] **Step 4: `asset-import-dialog.tsx`**

Modal simples: `<input type="file" accept=".csv">`, link `Baixar modelo` → `/modelo-ativos.csv`, botão Importar → `api('/assets/import', { method:'POST', body: fd })` com `FormData`. Ao voltar, renderiza `{created} criados` e uma tabela `linha | mensagem` para `errors`. Reaproveitar `Button`, `toast`.

- [ ] **Step 5: `ativos/page.tsx`**

Lista no molde de `clientes/page.tsx`: busca `q` com debounce 300ms, `Select` de status; `Select` de cliente (de `/clients`), `Select` de local dependente do cliente. Query:
`api<Paged<Asset>>('/assets?pageSize=100&...filtros...')`. Tabela: identificação (link para `/app/ativos/${id}`), tipo, cliente, local, status (`Badge`), nº série, garantia (texto vermelho se `warrantyEndsAt` < hoje). Botões no topo: "Novo ativo" (abre `asset-form` em painel) e "Importar CSV" (abre `asset-import-dialog`).

- [ ] **Step 6: `ativos/[id]/page.tsx`**

`useQuery(['asset', id], () => api<AssetDetail>(`/assets/${id}`))`. Blocos:
- Cabeçalho: `label` + `Badge` de status + links cliente/local.
- **Dados**: grid label/valor + botão Editar → `asset-form` com `initial` do detail; `PATCH /assets/:id`.
- **Credenciais**: se `hasCredentials`, botão "Revelar" → `api<{username,password}>('/assets/'+id+'/credentials')`, mostra os valores num bloco e um botão "Ocultar" (estado local, sem timer). Se não, texto "Nenhuma credencial cadastrada".
- **Fotos**: `useQuery(['asset-attachments', id], () => api(`/assets/${id}/attachments`))`; grid de miniaturas (`<img src={`/api/attachments/${att.id}`}>`); `<input type="file">` → `POST /assets/:id/attachments` (FormData), invalida a query.
- **Histórico**: tabela de `recentTickets` (número → link `/app/chamados/${t.id}`, título, status, responsável, data `toLocaleDateString('pt-BR')`). Sem paginação.

- [ ] **Step 7: Verificação**

Run em `C:/Users/renan/os-exec/frontend`: `npm run build`
Expected: build Next sem erro de tipo/lint.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/nav.tsx frontend/src/lib/assets.ts frontend/src/app/app/ativos frontend/src/components/asset-form.tsx frontend/src/components/asset-import-dialog.tsx
git commit -m "feat(assets): telas de ativos (lista, ficha, importação)"
```

---

## Task 9: Frontend — abas Locais e Ativos no cliente; aba Tipos de ativo

**Files:**
- Modify: `frontend/src/app/app/clientes/[id]/page.tsx` (abas "Locais" e "Ativos")
- Create: `frontend/src/components/location-form.tsx`
- Modify: `frontend/src/app/app/config/page.tsx` (aba "Tipos de ativo")

**Interfaces:**
- Consumes: `/locations?clientId=`, `/locations` (POST), `/locations/:id` (PATCH), `/assets?clientId=`, `/asset-types` (GET/POST/PATCH).
- Produces: `LocationForm` (name, address, contactName, contactPhone, accessNotes).

- [ ] **Step 1: `location-form.tsx`**

Molde `client-form.tsx`: `name` (obrigatório), `address`, `contactName`, `contactPhone`, `accessNotes` (`Textarea`). `onSubmit(values)`.

- [ ] **Step 2: Aba "Locais" no cliente**

No `clientes/[id]/page.tsx`, adicionar item às `Tabs` existentes. Componente `LocationsTab({ clientId })`:
- `useQuery(['locations', clientId], () => api<Paged<Location>>(`/locations?clientId=${clientId}&pageSize=100`))`
- lista com nome + endereço + `Badge` ativo/inativo + botão ativar/desativar (`PATCH /locations/:id { active }`)
- botão "Novo local" → `LocationForm` em painel → `POST /locations { clientId, ...values }`; trata 409 com `toast.error(e.message)`.

- [ ] **Step 3: Aba "Ativos" no cliente**

Componente `ClientAssetsTab({ clientId })`:
- `useQuery(['assets', 'client', clientId], () => api<Paged<Asset>>(`/assets?clientId=${clientId}&pageSize=100`))`
- tabela: identificação (link `/app/ativos/${id}`), tipo, local, status.
- botão "Novo ativo" → navega para `/app/ativos?novo=1&clientId=${clientId}` **ou** abre o `asset-form` inline com `clientId` fixo. Escolher inline para não complicar a rota.

- [ ] **Step 4: Aba "Tipos de ativo" em Config**

No `config/page.tsx`, clonar `CategoriesTab` como `AssetTypesTab` trocando o endpoint `/categories` → `/asset-types` e os textos. Adicionar `<Tabs>` item "Tipos de ativo". (A aba só faz sentido para ADMIN — seguir o gating que o arquivo já usa para as abas de ADMIN, ex. `useSession`.)

- [ ] **Step 5: Verificação**

Run: `npm run build` (frontend)
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/app/clientes frontend/src/components/location-form.tsx frontend/src/app/app/config/page.tsx
git commit -m "feat(assets): abas de locais e ativos no cliente e tipos em config"
```

---

## Task 10: Frontend — form e detalhe do chamado

**Files:**
- Modify: `frontend/src/app/app/chamados/novo/page.tsx` (remove Equipamento; adiciona Local + Ativos)
- Modify: `frontend/src/components/ticket-sidebar.tsx` (Row "Equipamento" → "Local" + "Ativos"; legado só se presente)
- Modify: `frontend/src/app/app/chamados/[id]/page.tsx` (editor de Local/Ativos via `PATCH /:id/assets`)
- Modify: `frontend/src/lib/tickets.ts` (tipos: `location`, `assets`, manter `equipment`)

**Interfaces:**
- Consumes: `/locations?clientId=`, `/assets?locationId=`, `PATCH /tickets/:id/assets`.
- Produces: no `lib/tickets.ts`, no tipo do ticket detalhado, `location?: { id: string; name: string } | null` e `assets?: { id: string; label: string; type?: { name: string } }[]`.

- [ ] **Step 1: Tipos**

Em `frontend/src/lib/tickets.ts`, no tipo do ticket (detalhe), adicionar `location` e `assets` conforme acima. Não remover `equipment` (legado).

- [ ] **Step 2: `chamados/novo` — trocar campo**

Remover o `useState('equipment')` e o bloco `<Label htmlFor="equip">`. Adicionar após Categoria/Prioridade:
- `const [locationId, setLocationId] = useState('')` e `const [assetIds, setAssetIds] = useState<string[]>([])`.
- `useQuery(['locations', clientId], () => api<Paged<{id,name}>>(`/locations?clientId=${clientId}&pageSize=100`), { enabled: !!clientId })`.
- `useQuery(['assets', locationId], () => api<Paged<Asset>>(`/assets?locationId=${locationId}&pageSize=100`), { enabled: !!locationId })`.
- `Select` de Local (desabilitado sem cliente; ao trocar, zera `assetIds`).
- Multiselect de Ativos: lista de checkboxes dos ativos do local (simples; sem lib). Desabilitado sem local.
- No `body` do `POST /tickets`: tirar `equipment`; adicionar `locationId: locationId || undefined`, `assetIds: assetIds.length ? assetIds : undefined`.

- [ ] **Step 3: `ticket-sidebar.tsx`**

Trocar a `Row label="Equipamento"` por:

```tsx
<Row label="Local">{ticket.location?.name ?? '—'}</Row>
<Row label="Ativos">
  {ticket.assets?.length
    ? ticket.assets.map((a) => (
        <a key={a.id} href={`/app/ativos/${a.id}`} className="mr-2 underline">
          {a.label}
        </a>
      ))
    : '—'}
</Row>
{ticket.equipment ? (
  <Row label="Equipamento (legado)">{ticket.equipment}</Row>
) : null}
```

- [ ] **Step 4: `chamados/[id]` — editor**

Adicionar (só lado equipe) um botão "Editar local/ativos" que abre um painel com os mesmos `Select` de Local + checkboxes de Ativos do Task 10 Step 2, pré-carregados de `ticket.location`/`ticket.assets`. Salvar → `api(`/tickets/${id}/assets`, { method:'PATCH', body: { locationId: locationId || null, assetIds } })` → invalida `['ticket', id]`.

- [ ] **Step 5: Verificação**

Run: `npm run build` (frontend)
Expected: OK. Conferir que nenhum outro arquivo referencia `equipment` como campo editável (`grep -rn "equipment" frontend/src`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/app/chamados frontend/src/components/ticket-sidebar.tsx frontend/src/lib/tickets.ts
git commit -m "feat(tickets): local e ativos no form e no detalhe do chamado"
```

---

## Task 11: Integração, E2E, changelog e release 0.3.0

**Files:**
- Create: `backend/src/assets/assets.integration.spec.ts`
- Create: `backend/src/assets/assets-import.integration.spec.ts`
- Modify/Create: `frontend/e2e/*` (fumaça: local + ativo + chamado)
- Modify: `CHANGELOG.md`
- Modify: `package.json` raiz / `backend/package.json` / `frontend/package.json` se a versão for versionada lá (conferir como as releases anteriores fizeram — `grep -rn '"version"' package.json backend/package.json frontend/package.json`)

**Interfaces:**
- Consumes: tudo das tasks anteriores.

- [ ] **Step 1: Integração — CRUD + credenciais + papel**

`backend/src/assets/assets.integration.spec.ts` seguindo o padrão de `tickets-visibility.integration.spec.ts` (skip sem `DATABASE_URL`, prefixo `ATL-${Date.now()}`, `cleanup` em `beforeAll`/`afterAll` apagando assets/locations/asset_types/clients do prefixo). Casos:
- cria client → location → assetType → `AssetsService.create` com credenciais → `findOne` traz `hasCredentials: true` e **não** traz `credentialsEnc`.
- `revealCredentials` devolve o par correto.
- `create` com `locationId` de outro client → `BadRequestException`.
- `serialNumber` duplicado no mesmo client → `BadRequestException`; mesmo serial em client diferente → OK.
- `AssetsController` via `Test.createTestingModule` + `supertest`: `GET /assets/:id/credentials` como `CONTACT`/`MANAGER` → 403; como `AGENT` → 200. (Reaproveitar o helper de auth dos testes de integração existentes, se houver; senão montar token de teste como os outros specs fazem.)

- [ ] **Step 2: Integração — importação CSV**

`backend/src/assets/assets-import.integration.spec.ts`: cria client + 1 location + 1 assetType reais; monta um CSV com 3 linhas — 1 boa, 1 com tipo inexistente, 1 com data inválida — chama `AssetsImportService.import(Buffer)`; espera `created: 1` e 2 `errors` com `line` correto; confirma no banco que 1 asset foi criado.

- [ ] **Step 3: Rodar integração**

Run em `C:/Users/renan/os-exec/backend`: `docker compose up -d postgres && npm run test:integration`
Expected: PASS (ou skip explícito se o Postgres não subir — não deve, localmente sobe).

- [ ] **Step 4: E2E de fumaça**

Em `frontend/e2e/`, adicionar um spec Playwright curto (login como ADMIN — reaproveitar o helper de login existente): abre um cliente → aba Locais → cria "Matriz" → `/app/ativos` → "Novo ativo" (cliente, Matriz, tipo Câmera, identificação "CAM-E2E") → salva → abre "Novo chamado" → seleciona cliente, Local Matriz, marca o ativo CAM-E2E → cria → confirma que o detalhe do chamado mostra "CAM-E2E" na sidebar.

- [ ] **Step 5: Rodar E2E**

Run: `npm run test:e2e` (frontend)
Expected: PASS.

- [ ] **Step 6: CHANGELOG + versão**

Em `CHANGELOG.md`, criar a seção `## [0.3.0] - 2026-09-09` (mover de "Não lançado"):

```markdown
### Adicionado
- Cadastro de **Locais** por cliente (endereço, contato no local, observações
  de acesso).
- **Tipos de ativo** configuráveis pelo ADMIN (aba em Configurações).
- Cadastro de **Ativos/equipamentos** por local: dados de rede (IP/MAC),
  credenciais de acesso criptografadas (visíveis só à equipe), fotos, garantia
  e status.
- Chamado passa a referenciar um **Local** e um ou mais **Ativos**; a ficha do
  ativo lista o histórico de chamados vinculados.
- Importação de ativos por **CSV** (cliente, local e tipo resolvidos por nome;
  relatório de erros por linha).

### Alterado
- O campo livre "Equipamento" do chamado foi aposentado: sai dos formulários e
  fica só-leitura em chamados antigos que já tinham valor.
```

Bump de versão onde as releases anteriores bumparam (conferir Step "Files").

- [ ] **Step 7: Rodar a suíte toda**

Run em `backend`: `npm test && npm run build`
Run em `frontend`: `npm run build`
Expected: tudo verde.

- [ ] **Step 8: Commit + tag**

```bash
git add -A
git commit -m "chore: release 0.3.0 — ativos e locais"
git tag v0.3.0
```

- [ ] **Step 9: Sincronizar Z:**

Depois do `git push` + `git push --tags` (feito pelo usuário ou pelo fluxo de deploy), rodar o pull-ff em `Z:/Projetos/OS` (ver memória `push-implica-pull-z`). Build/push das imagens Docker e redeploy no Portainer seguem o `deploy/README.md` — **fora do escopo deste plano**, mas anotar no handoff.

---

## Self-Review

**1. Spec coverage**

| Spec §                                   | Task |
|------------------------------------------|------|
| §2 Location model + `@@unique`           | 1, 3 |
| §2 AssetType configurável                | 1, 2 |
| §2 Asset (campos, status, série única)   | 1, 4 |
| §2 credenciais AES, `hasCredentials`     | 4 |
| §2 foto = `Attachment.assetId`           | 1, 5 |
| §2 histórico derivado                    | 4 (`recentTickets`), 8 |
| §2/§3.2 Chamado ↔ Local + Ativos N:N     | 1, 7 |
| §3.2 aposentar `equipment`               | 7, 10 |
| §3.2 eventos `LOCATION_CHANGED`/`ASSETS_CHANGED` | 1, 7 |
| §3.4 importação CSV + modelo             | 6 |
| §3.5 telas (lista, ficha, abas, config, chamado) | 8, 9, 10 |
| §5 erros e bordas                        | 3, 4, 6, 7 (testes) |
| §6 testes unit/integração/E2E            | 2–7, 11 |
| §8 release 0.3.0                         | 11 |

Sem lacunas. Desvio registrado: a spec §3.2 citava um `UpdateTicketDto` inexistente; Task 7 Step 9 corrige a spec para `PATCH /tickets/:id/assets`.

**2. Placeholder scan**

Blocos de teste do backend nas Tasks 5 e 7 estão descritos como comentários de intenção (`// prisma... -> ...`) em vez de código pronto, porque dependem do `makePrisma`/helpers locais de cada arquivo de spec, que variam. O implementador preenche seguindo os exemplos completos das Tasks 2, 3, 4 e 6. Não há `TODO`/`TBD` nos passos de implementação.

**3. Type consistency**

- `serializeAsset` (Task 4) — usado em 4; `hasCredentials` aparece em `lib/assets.ts` (Task 8) com o mesmo nome.
- `setTicketAssets(id, { locationId, assetIds }, actor)` (Task 7) — chamado pelo controller em Task 7 Step 8 e pelo front em Task 10 Step 4 com o mesmo shape.
- `ImportResult { created, errors: [{ line, message }] }` (Task 6) — consumido pelo modal em Task 8 Step 4 e testado em Task 11 Step 2.
- Rotas: `/assets`, `/assets/:id`, `/assets/:id/credentials`, `/assets/:id/attachments`, `/assets/import`, `/asset-types`, `/locations` — idênticas entre controllers (Tasks 2,4,5,6) e chamadas do front (Tasks 8,9,10).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-09-ativos-locais.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch de um subagente por task, revisão entre tasks, iteração rápida.

**2. Inline Execution** — executa as tasks nesta sessão com checkpoints de revisão.

**Which approach?**
