# Agenda e Execução em Campo (Fase 0.4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao chamado uma ou mais visitas técnicas agendadas, executadas em campo com checklist, fotos, assinatura do cliente e apontamento de horas, fechadas com um laudo em PDF enviado automaticamente ao cliente.

**Architecture:** Dois módulos NestJS novos — `checklist-templates` (CRUD simples, molde de `asset-types`) e `visits` (agendamento, check-in/out, checklist, fechamento + `VisitReportService` que gera o PDF com `pdfkit` e dispara e-mail via `EmailService` já existente). Fotos e assinatura reaproveitam `AttachmentsService`/`AttachmentsController` (ganham um `kind` e um `visitId`). O laudo em PDF também vira um `Attachment`, mas com `ticketId` setado (além de `visitId`) — assim ele aparece de graça na lista de anexos que o portal do cliente já renderiza, sem precisar de rota de download nova. Frontend: `/app/agenda` (lista por técnico/dia, agendar/reagendar/cancelar), bloco "Visitas" no detalhe do chamado, `/app/campo` (mobile, execução da visita: check-in, checklist, fotos, assinatura em canvas, check-out, fechar), aba "Checklists" em Configurações.

**Tech Stack:** NestJS (ESM, imports `.js`), Prisma 6 + Postgres, class-validator, `pdfkit` (dependência nova, PDF sem Chromium), Vitest (unit + integração com Postgres real), Next.js App Router + React Query + shadcn/ui, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-agenda-campo-design.md`

## Global Constraints

- **Base:** `main` @ `0bde7d5` (spec da fase commitado; release 0.3.0 já lançada).
- **Execução em disco local:** rodar `npm`/`prisma`/testes em `C:/Users/renan/os-exec` (clone com `origin = github.com/onedayinfo/OS`). `Z:/Projetos/OS` é a working copy do usuário, mantida por push→pull-ff. `next dev`/`vitest` no share SMB estouram timeout.
- **Imports ESM:** todo import relativo termina em `.js` (ex.: `./visits.service.js`), mesmo apontando para `.ts`.
- **Papéis:** internos `ADMIN`/`AGENT`; cliente `MANAGER`/`CONTACT`. Agenda, campo e checklists são **só internos** (`@Roles('ADMIN','AGENT')`), exceto onde uma rota fica sem `@Roles` de propósito (nenhuma nesta fase — cliente não toca em visita).
- **`@Roles(...)`** por rota/controller; sem `@Roles` = qualquer autenticado. O `JwtAuthGuard` é global; `RolesGuard` usa `getAllAndOverride` — `@Roles` no método sobrepõe o do controller.
- **`CurrentUser`** (`../common/current-user.decorator.js`) injeta `{ id, type, role, clientId }` do JWT.
- **Vitest globals:** `describe/it/expect/vi` sem import (`types: ["vitest/globals"]` no `tsconfig.json`).
- **Testes de integração:** padrão do repo — `new PrismaClient()`, pula com `console.warn` + exit 0 se `!process.env.DATABASE_URL` ou conexão falhar; prefixo único (`AGD-${Date.now()}`) + `cleanup()` em `beforeAll`/`afterAll`. Config: `vitest.config.integration.ts`, script `npm run test:integration`.
- **Conventional Commits** + `CHANGELOG.md` (Keep a Changelog) na seção `[Não lançado]` durante o desenvolvimento. Release final = **0.4.0** (MINOR). Nenhuma env nova.
- **Sem geofence, sem calendário visual, sem WhatsApp, sem ativos-no-portal** nesta fase (adiado para sessões futuras — spec §1).

---

## Task 1: Schema Prisma — modelos e migração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_visits_checklists/migration.sql` (gerada pelo Prisma)

**Interfaces:**
- Produces: enums `VisitStatus`, `AttachmentKind`; modelos `ChecklistTemplate`, `ChecklistTemplateItem`, `Visit`, `VisitChecklistAnswer`; `Attachment.visitId String?` + `Attachment.kind AttachmentKind @default(GENERIC)`; `Ticket.visits Visit[]`; `Category.checklistTemplate ChecklistTemplate?`; `TicketEventType` += `VISIT_SCHEDULED`, `VISIT_STARTED`, `VISIT_COMPLETED`, `VISIT_CANCELLED`.

- [ ] **Step 1: Editar `schema.prisma` — enums novos**

Depois do enum `AssetStatus`, adicionar:

```prisma
enum VisitStatus {
  SCHEDULED
  IN_PROGRESS
  DONE
  CANCELLED
}

enum AttachmentKind {
  GENERIC
  PHOTO_BEFORE
  PHOTO_AFTER
  SIGNATURE
  REPORT
}
```

- [ ] **Step 2: Editar `schema.prisma` — `TicketEventType`**

Adicionar quatro valores ao enum existente:

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
  VISIT_SCHEDULED
  VISIT_STARTED
  VISIT_COMPLETED
  VISIT_CANCELLED
}
```

- [ ] **Step 3: Editar `schema.prisma` — `Category` ganha a relação reversa**

No `model Category`, adicionar à lista de relações (depois de `tickets Ticket[]`):

```prisma
  checklistTemplate ChecklistTemplate?
```

- [ ] **Step 4: Editar `schema.prisma` — modelos novos**

Adicionar depois do `model Category`:

```prisma
model ChecklistTemplate {
  id         String   @id @default(cuid())
  categoryId String?  @unique
  name       String
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  category Category?               @relation(fields: [categoryId], references: [id])
  items    ChecklistTemplateItem[]
  visits   Visit[]

  @@map("checklist_templates")
}

model ChecklistTemplateItem {
  id         String @id @default(cuid())
  templateId String
  label      String
  order      Int    @default(0)

  template ChecklistTemplate       @relation(fields: [templateId], references: [id], onDelete: Cascade)
  answers  VisitChecklistAnswer[]

  @@index([templateId])
  @@map("checklist_template_items")
}

model Visit {
  id                  String      @id @default(cuid())
  ticketId            String
  technicianId        String
  checklistTemplateId String?
  status              VisitStatus @default(SCHEDULED)
  scheduledStart      DateTime
  scheduledEnd        DateTime
  checkInAt           DateTime?
  checkInLat          Float?
  checkInLng          Float?
  checkOutAt          DateTime?
  checkOutLat         Float?
  checkOutLng         Float?
  laborStartAt        DateTime?
  laborEndAt          DateTime?
  notes               String?
  reportSentAt        DateTime?
  createdAt           DateTime    @default(now())
  updatedAt           DateTime    @updatedAt

  ticket            Ticket                  @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  technician        User                    @relation(fields: [technicianId], references: [id])
  checklistTemplate ChecklistTemplate?      @relation(fields: [checklistTemplateId], references: [id])
  checklistAnswers  VisitChecklistAnswer[]
  attachments       Attachment[]

  @@index([ticketId])
  @@index([technicianId])
  @@map("visits")
}

model VisitChecklistAnswer {
  id      String  @id @default(cuid())
  visitId String
  itemId  String
  done    Boolean @default(false)
  note    String?

  visit Visit                 @relation(fields: [visitId], references: [id], onDelete: Cascade)
  item  ChecklistTemplateItem @relation(fields: [itemId], references: [id])

  @@unique([visitId, itemId])
  @@map("visit_checklist_answers")
}
```

- [ ] **Step 5: Editar `schema.prisma` — `User`, `Ticket`, `Attachment`**

No `model User`, adicionar à lista de relações (o técnico da visita é um `User`):

```prisma
  visits Visit[]
```

No `model Ticket`, adicionar:

```prisma
  visits Visit[]
```

No `model Attachment`, adicionar campo + relação + índice:

```prisma
  visitId String?
  kind    AttachmentKind @default(GENERIC)
  ...
  visit Visit? @relation(fields: [visitId], references: [id], onDelete: Cascade)
  ...
  @@index([visitId])
```

- [ ] **Step 6: Validar e gerar a migração**

Rodar em `C:/Users/renan/os-exec/backend`:

```bash
npx prisma validate
npx prisma migrate dev --name add_visits_checklists
npx prisma generate
```

Expected: `validate` OK; migração criada e aplicada sem erro; client regenerado com `Visit`, `ChecklistTemplate`, `ChecklistTemplateItem`, `VisitChecklistAnswer`, `VisitStatus`, `AttachmentKind`.

- [ ] **Step 7: Build de sanidade**

Run: `npm run build`
Expected: `nest build` compila sem erro de tipo.

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(visits): schema de visitas, checklists e anexos de visita"
```

---

## Task 2: Módulo `checklist-templates`

**Files:**
- Create: `backend/src/checklist-templates/checklist-templates.module.ts`
- Create: `backend/src/checklist-templates/checklist-templates.service.ts`
- Create: `backend/src/checklist-templates/checklist-templates.controller.ts`
- Create: `backend/src/checklist-templates/dto/checklist-item.dto.ts`
- Create: `backend/src/checklist-templates/dto/create-checklist-template.dto.ts`
- Create: `backend/src/checklist-templates/dto/update-checklist-template.dto.ts`
- Create: `backend/src/checklist-templates/checklist-templates.service.spec.ts`
- Modify: `backend/src/app.module.ts` (registrar `ChecklistTemplatesModule`)

**Interfaces:**
- Consumes: `PrismaService` de `../prisma/prisma.service.js`.
- Produces: `ChecklistTemplatesService` com `onModuleInit()` (seed idempotente do template padrão `categoryId: null`), `findAll(categoryId?)`, `create(dto)`, `update(id, dto)`, `resolveForCategory(categoryId: string | null): Promise<{ id: string } | null>` — usado pelo `VisitsService` (Task 3) pra resolver o template de uma visita nova. Exportado pelo módulo.

- [ ] **Step 1: DTOs**

`backend/src/checklist-templates/dto/checklist-item.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class ChecklistItemInput {
  // presente = atualiza o item existente; ausente = cria um novo.
  @IsOptional() @IsString() id?: string;
  @IsString() @MinLength(1) label!: string;
  @IsOptional() @IsInt() order?: number;
}
```

`backend/src/checklist-templates/dto/create-checklist-template.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { ChecklistItemInput } from './checklist-item.dto.js';

export class CreateChecklistTemplateDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsString() @MinLength(1) name!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemInput)
  items!: ChecklistItemInput[];
}
```

`backend/src/checklist-templates/dto/update-checklist-template.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ChecklistItemInput } from './checklist-item.dto.js';

export class UpdateChecklistTemplateDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  // Só adiciona/renomeia itens (sem `id` = novo). Nunca remove — um item já
  // respondido numa visita não pode sumir (spec §3.2).
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemInput)
  items?: ChecklistItemInput[];
}
```

- [ ] **Step 2: Escrever o teste que falha**

`backend/src/checklist-templates/checklist-templates.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChecklistTemplatesService } from './checklist-templates.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    checklistTemplate: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'ct1', ...data, items: data.items?.create ?? [] }),
      ),
      update: vi.fn().mockResolvedValue({ id: 'ct1' }),
    },
    checklistTemplateItem: {
      update: vi.fn(),
      create: vi.fn(),
    },
    ...overrides,
  };
}

describe('ChecklistTemplatesService', () => {
  it('onModuleInit: cria o template padrão só se ainda não existir', async () => {
    const prisma = makePrisma();
    const service = new ChecklistTemplatesService(prisma as any);
    await service.onModuleInit();
    expect(prisma.checklistTemplate.findFirst).toHaveBeenCalledWith({
      where: { categoryId: null },
    });
    expect(prisma.checklistTemplate.create).toHaveBeenCalledTimes(1);
    const arg = (prisma.checklistTemplate.create as any).mock.calls[0][0];
    expect(arg.data.categoryId).toBeNull();
    expect(arg.data.items.create.length).toBeGreaterThan(0);
  });

  it('onModuleInit: não recria se já existe', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi.fn().mockResolvedValue({ id: 'ct-padrao' }),
        create: vi.fn(),
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    await service.onModuleInit();
    expect(prisma.checklistTemplate.create).not.toHaveBeenCalled();
  });

  it('create: rejeita categoria que já tem template', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ id: 'existente' }),
        create: vi.fn(),
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    await expect(
      service.create({ categoryId: 'cat1', name: 'X', items: [{ label: 'a' }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: 404 se não existir', async () => {
    const service = new ChecklistTemplatesService(makePrisma() as any);
    await expect(service.update('nope', { name: 'Y' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolveForCategory: cai no padrão quando a categoria não tem template ativo', async () => {
    const prisma = makePrisma({
      checklistTemplate: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // específico da categoria
          .mockResolvedValueOnce({ id: 'padrao' }), // fallback categoryId:null
      },
    });
    const service = new ChecklistTemplatesService(prisma as any);
    const resolved = await service.resolveForCategory('cat1');
    expect(resolved).toEqual({ id: 'padrao' });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/checklist-templates/checklist-templates.service.spec.ts`
Expected: FAIL — módulo `./checklist-templates.service.js` não existe.

- [ ] **Step 4: `checklist-templates.service.ts`**

```ts
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto.js';
import { UpdateChecklistTemplateDto } from './dto/update-checklist-template.dto.js';

const DEFAULT_ITEMS = [
  'Energia ok',
  'Equipamento funcionando',
  'Local limpo',
  'Cliente orientado',
];

@Injectable()
export class ChecklistTemplatesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.prisma.checklistTemplate.findFirst({ where: { categoryId: null } });
    if (existing) return;
    await this.prisma.checklistTemplate.create({
      data: {
        categoryId: null,
        name: 'Checklist padrão',
        items: { create: DEFAULT_ITEMS.map((label, order) => ({ label, order })) },
      },
    });
  }

  findAll(categoryId?: string) {
    return this.prisma.checklistTemplate.findMany({
      where: categoryId ? { categoryId } : undefined,
      include: { items: { orderBy: { order: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateChecklistTemplateDto) {
    if (dto.categoryId) {
      const dup = await this.prisma.checklistTemplate.findUnique({
        where: { categoryId: dto.categoryId },
      });
      if (dup) throw new BadRequestException('Essa categoria já tem um checklist.');
    }
    return this.prisma.checklistTemplate.create({
      data: {
        categoryId: dto.categoryId ?? null,
        name: dto.name,
        items: { create: dto.items.map((i, idx) => ({ label: i.label, order: i.order ?? idx })) },
      },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  async update(id: string, dto: UpdateChecklistTemplateDto) {
    const found = await this.prisma.checklistTemplate.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Checklist não encontrado.');

    if (dto.name !== undefined || dto.active !== undefined) {
      await this.prisma.checklistTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    }

    // Só adiciona/renomeia — nunca remove (um item já respondido não some).
    if (dto.items) {
      for (const [idx, item] of dto.items.entries()) {
        if (item.id) {
          await this.prisma.checklistTemplateItem.update({
            where: { id: item.id },
            data: { label: item.label, order: item.order ?? idx },
          });
        } else {
          await this.prisma.checklistTemplateItem.create({
            data: { templateId: id, label: item.label, order: item.order ?? idx },
          });
        }
      }
    }

    return this.prisma.checklistTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: { order: 'asc' } } },
    });
  }

  /** Resolve o template ativo pra uma categoria; cai no padrão (`categoryId: null`). */
  async resolveForCategory(categoryId: string | null): Promise<{ id: string } | null> {
    if (categoryId) {
      const specific = await this.prisma.checklistTemplate.findFirst({
        where: { categoryId, active: true },
      });
      if (specific) return specific;
    }
    return this.prisma.checklistTemplate.findFirst({ where: { categoryId: null, active: true } });
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/checklist-templates/checklist-templates.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: `checklist-templates.controller.ts`**

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto.js';
import { UpdateChecklistTemplateDto } from './dto/update-checklist-template.dto.js';

@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly templates: ChecklistTemplatesService) {}

  @Get()
  @Roles('ADMIN', 'AGENT')
  findAll(@Query('categoryId') categoryId?: string) {
    return this.templates.findAll(categoryId);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateChecklistTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateChecklistTemplateDto) {
    return this.templates.update(id, dto);
  }
}
```

- [ ] **Step 7: `checklist-templates.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import { ChecklistTemplatesController } from './checklist-templates.controller.js';

@Module({
  providers: [ChecklistTemplatesService],
  controllers: [ChecklistTemplatesController],
  exports: [ChecklistTemplatesService],
})
export class ChecklistTemplatesModule {}
```

- [ ] **Step 8: Registrar no `app.module.ts`**

Adicionar o import e a entrada em `imports` (perto de `AssetTypesModule`):

```ts
import { ChecklistTemplatesModule } from './checklist-templates/checklist-templates.module.js';
```
```ts
    ChecklistTemplatesModule,
```

- [ ] **Step 9: Build + testes**

Run: `npm run build && npx vitest run src/checklist-templates`
Expected: ambos verdes.

- [ ] **Step 10: Commit**

```bash
git add backend/src/checklist-templates backend/src/app.module.ts
git commit -m "feat(visits): módulo checklist-templates com seed padrão"
```

---

## Task 3: Módulo `visits` — agendar, reagendar, cancelar

**Files:**
- Create: `backend/src/visits/visits.module.ts`
- Create: `backend/src/visits/visits.service.ts`
- Create: `backend/src/visits/visits.controller.ts`
- Create: `backend/src/visits/dto/create-visit.dto.ts`
- Create: `backend/src/visits/dto/update-visit.dto.ts`
- Create: `backend/src/visits/dto/list-visits.dto.ts`
- Create: `backend/src/visits/visits.service.spec.ts`
- Modify: `backend/src/app.module.ts` (registrar `VisitsModule`)

**Interfaces:**
- Consumes: `PrismaService`; `TicketEventsService.record(client, ticketId, type, data?, actorId?)` (exportado por `TicketsModule`); `ChecklistTemplatesService.resolveForCategory` (exportado por `ChecklistTemplatesModule`, Task 2).
- Produces: `VisitsService` com `create`, `reschedule`, `cancel`, `findAll(filter)`, `findOne(id)` — consumidos pelas Tasks 4/5/6/8. `VisitsController` em `/visits`.

- [ ] **Step 1: DTOs**

`backend/src/visits/dto/create-visit.dto.ts`:

```ts
import { IsISO8601, IsString, MinLength } from 'class-validator';

export class CreateVisitDto {
  @IsString() @MinLength(1) ticketId!: string;
  @IsString() @MinLength(1) technicianId!: string;
  @IsISO8601() scheduledStart!: string;
  @IsISO8601() scheduledEnd!: string;
}
```

`backend/src/visits/dto/update-visit.dto.ts`:

```ts
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateVisitDto {
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsISO8601() scheduledStart?: string;
  @IsOptional() @IsISO8601() scheduledEnd?: string;
}
```

`backend/src/visits/dto/list-visits.dto.ts`:

```ts
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;

export class ListVisitsDto {
  @IsOptional() @IsString() technicianId?: string;
  @IsOptional() @IsDateString() date?: string; // YYYY-MM-DD
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() ticketId?: string;
}
```

- [ ] **Step 2: Escrever o teste que falha**

`backend/src/visits/visits.service.spec.ts` (parte 1 — as demais partes chegam nas Tasks 4/5/6):

```ts
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VisitsService } from './visits.service.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    ticket: {
      findUnique: vi.fn().mockResolvedValue({ id: 't1', categoryId: null, status: 'OPEN' }),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'tech1', type: 'INTERNAL', role: 'AGENT', active: true }),
    },
    visit: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'v1', status: 'SCHEDULED', ...data }),
      ),
      findUnique: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'v1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([]) },
    visitChecklistAnswer: { count: vi.fn().mockResolvedValue(0), upsert: vi.fn() },
    attachment: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn() },
    ...overrides,
  };
  const events = { record: vi.fn() };
  const templates = { resolveForCategory: vi.fn().mockResolvedValue({ id: 'tmpl1' }) };
  const report = { generate: vi.fn(), sendEmail: vi.fn() };
  const service = new VisitsService(prisma as any, events as any, templates as any, report as any);
  return { service, prisma, events, templates, report };
}

describe('VisitsService.create', () => {
  it('cria a visita e resolve o template pela categoria do chamado', async () => {
    const { service, prisma, events, templates } = makeDeps();
    await service.create({
      ticketId: 't1',
      technicianId: 'tech1',
      scheduledStart: '2026-10-01T13:00:00.000Z',
      scheduledEnd: '2026-10-01T14:00:00.000Z',
    });
    expect(templates.resolveForCategory).toHaveBeenCalledWith(null);
    expect(prisma.visit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't1', technicianId: 'tech1', checklistTemplateId: 'tmpl1' }),
      }),
    );
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_SCHEDULED', expect.any(Object));
  });

  it('rejeita chamado inexistente', async () => {
    const { service, prisma } = makeDeps({ ticket: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(
      service.create({ ticketId: 'nope', technicianId: 'tech1', scheduledStart: '2026-10-01T13:00:00.000Z', scheduledEnd: '2026-10-01T14:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.visit.create).not.toHaveBeenCalled();
  });

  it('rejeita técnico que não é AGENT ativo', async () => {
    const { service } = makeDeps({
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u2', type: 'INTERNAL', role: 'ADMIN', active: true }) },
    });
    await expect(
      service.create({ ticketId: 't1', technicianId: 'u2', scheduledStart: '2026-10-01T13:00:00.000Z', scheduledEnd: '2026-10-01T14:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita janela invertida (fim antes do início)', async () => {
    const { service } = makeDeps();
    await expect(
      service.create({ ticketId: 't1', technicianId: 'tech1', scheduledStart: '2026-10-01T14:00:00.000Z', scheduledEnd: '2026-10-01T13:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VisitsService.reschedule / cancel', () => {
  it('reschedule: só permitido com status SCHEDULED', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', scheduledStart: new Date(), scheduledEnd: new Date() }) },
    });
    await expect(service.reschedule('v1', { scheduledStart: '2026-10-02T10:00:00.000Z' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.visit.update).not.toHaveBeenCalled();
  });

  it('cancel: rejeita visita já DONE', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await expect(service.cancel('v1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancel: 404 se a visita não existe', async () => {
    const { service } = makeDeps({ visit: { findUnique: vi.fn().mockResolvedValue(null) } });
    await expect(service.cancel('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: FAIL — `./visits.service.js` não existe.

- [ ] **Step 4: `visits.service.ts` (versão inicial — agendamento)**

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { ChecklistTemplatesService } from '../checklist-templates/checklist-templates.service.js';
import type { VisitReportService } from './visit-report.service.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { UpdateVisitDto } from './dto/update-visit.dto.js';
import { ListVisitsDto } from './dto/list-visits.dto.js';

const VISIT_INCLUDE = {
  ticket: {
    select: {
      id: true,
      number: true,
      title: true,
      client: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
    },
  },
  technician: { select: { id: true, name: true } },
} as const;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: TicketEventsService,
    private readonly templates: ChecklistTemplatesService,
    private readonly report: VisitReportService,
  ) {}

  private async assertTechnician(technicianId: string): Promise<void> {
    const tech = await this.prisma.user.findUnique({ where: { id: technicianId } });
    if (!tech || tech.type !== 'INTERNAL' || tech.role !== 'AGENT' || !tech.active) {
      throw new BadRequestException('Técnico inválido: precisa ser um agente interno ativo.');
    }
  }

  private assertWindow(start: Date, end: Date): void {
    if (end <= start) {
      throw new BadRequestException('scheduledEnd precisa ser depois de scheduledStart.');
    }
  }

  async create(dto: CreateVisitDto) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: dto.ticketId } });
    if (!ticket) throw new BadRequestException('Chamado não encontrado.');
    await this.assertTechnician(dto.technicianId);

    const start = new Date(dto.scheduledStart);
    const end = new Date(dto.scheduledEnd);
    this.assertWindow(start, end);

    const template = await this.templates.resolveForCategory(ticket.categoryId);
    const visit = await this.prisma.visit.create({
      data: {
        ticketId: dto.ticketId,
        technicianId: dto.technicianId,
        scheduledStart: start,
        scheduledEnd: end,
        checklistTemplateId: template?.id ?? null,
      },
    });
    await this.events.record(this.prisma, dto.ticketId, 'VISIT_SCHEDULED', {
      visitId: visit.id,
      technicianId: dto.technicianId,
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
    });
    return this.findOne(visit.id);
  }

  private async mustFind(id: string) {
    const visit = await this.prisma.visit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Visita não encontrada.');
    return visit;
  }

  async reschedule(id: string, dto: UpdateVisitDto) {
    const visit = await this.mustFind(id);
    if (visit.status !== 'SCHEDULED') {
      throw new ConflictException('Só dá pra reagendar uma visita ainda agendada.');
    }
    if (dto.technicianId) await this.assertTechnician(dto.technicianId);

    const start = dto.scheduledStart ? new Date(dto.scheduledStart) : visit.scheduledStart;
    const end = dto.scheduledEnd ? new Date(dto.scheduledEnd) : visit.scheduledEnd;
    this.assertWindow(start, end);

    await this.prisma.visit.update({
      where: { id },
      data: {
        technicianId: dto.technicianId ?? undefined,
        scheduledStart: start,
        scheduledEnd: end,
      },
    });
    return this.findOne(id);
  }

  async cancel(id: string) {
    const visit = await this.mustFind(id);
    if (visit.status === 'DONE' || visit.status === 'CANCELLED') {
      throw new ConflictException('Visita já encerrada.');
    }
    await this.prisma.visit.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.events.record(this.prisma, visit.ticketId, 'VISIT_CANCELLED', { visitId: id });
    return this.findOne(id);
  }

  async findAll(filter: ListVisitsDto) {
    const where: Prisma.VisitWhereInput = {};
    if (filter.technicianId) where.technicianId = filter.technicianId;
    if (filter.ticketId) where.ticketId = filter.ticketId;
    if (filter.status) where.status = filter.status;
    if (filter.date) {
      where.scheduledStart = {
        gte: new Date(`${filter.date}T00:00:00.000Z`),
        lte: new Date(`${filter.date}T23:59:59.999Z`),
      };
    }
    return this.prisma.visit.findMany({
      where,
      orderBy: [{ scheduledStart: 'asc' }],
      include: VISIT_INCLUDE,
    });
  }

  async findOne(id: string) {
    const visit = await this.prisma.visit.findUnique({
      where: { id },
      include: {
        ...VISIT_INCLUDE,
        checklistTemplate: { include: { items: { orderBy: { order: 'asc' } } } },
        checklistAnswers: true,
        attachments: true,
      },
    });
    if (!visit) throw new NotFoundException('Visita não encontrada.');
    return visit;
  }
}
```

`VisitReportService` ainda não existe (chega na Task 7) — este passo cria só o `import type` e o parâmetro no construtor; o teste passa um mock `{ generate, sendEmail }` no lugar. A classe real é criada na Task 7; até lá, `visits.module.ts` (Step 6) provê um `VisitReportService` mínimo (placeholder) pra o Nest injetar sem quebrar o boot.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: PASS (os testes das Tasks 4/5/6 ainda não foram escritos).

- [ ] **Step 6: `visit-report.service.ts` — stub temporário**

Cria só o esqueleto pra satisfazer a injeção de dependência; o conteúdo real chega na Task 7.

```ts
import { Injectable } from '@nestjs/common';
import type { Attachment } from '@prisma/client';

@Injectable()
export class VisitReportService {
  async generate(_visitId: string): Promise<Attachment> {
    throw new Error('VisitReportService.generate ainda não implementado (Task 7).');
  }

  async sendEmail(_visitId: string, _attachment: Attachment): Promise<void> {
    throw new Error('VisitReportService.sendEmail ainda não implementado (Task 7).');
  }
}
```

- [ ] **Step 7: `visits.controller.ts` (rotas desta task)**

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { VisitsService } from './visits.service.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { UpdateVisitDto } from './dto/update-visit.dto.js';
import { ListVisitsDto } from './dto/list-visits.dto.js';

@Controller('visits')
@Roles('ADMIN', 'AGENT')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  findAll(@Query() query: ListVisitsDto, @CurrentUser() actor: CurrentUserData) {
    const technicianId = query.technicianId === 'me' ? actor.id : query.technicianId;
    return this.visits.findAll({ ...query, technicianId });
  }

  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @Patch(':id')
  reschedule(@Param('id') id: string, @Body() dto: UpdateVisitDto) {
    return this.visits.reschedule(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.visits.cancel(id);
  }
}
```

- [ ] **Step 8: `visits.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { ChecklistTemplatesModule } from '../checklist-templates/checklist-templates.module.js';
import { EmailModule } from '../email/email.module.js';
import { VisitsService } from './visits.service.js';
import { VisitsController } from './visits.controller.js';
import { VisitReportService } from './visit-report.service.js';

@Module({
  imports: [TicketsModule, ChecklistTemplatesModule, EmailModule],
  providers: [VisitsService, VisitReportService],
  controllers: [VisitsController],
  exports: [VisitsService],
})
export class VisitsModule {}
```

- [ ] **Step 9: Registrar no `app.module.ts`**

```ts
import { VisitsModule } from './visits/visits.module.js';
```
```ts
    VisitsModule,
```

- [ ] **Step 10: Build + testes**

Run: `npm run build && npx vitest run src/visits`
Expected: ambos verdes.

- [ ] **Step 11: Commit**

```bash
git add backend/src/visits backend/src/app.module.ts
git commit -m "feat(visits): agendar, reagendar e cancelar visita"
```

---

## Task 4: `VisitsService` — check-in, check-out e apontamento de horas

**Files:**
- Modify: `backend/src/visits/visits.service.ts`
- Modify: `backend/src/visits/visits.controller.ts`
- Create: `backend/src/visits/dto/geo.dto.ts`
- Create: `backend/src/visits/dto/labor.dto.ts`
- Modify: `backend/src/visits/visits.service.spec.ts`

**Interfaces:**
- Produces: `VisitsService.checkIn(id, dto)`, `checkOut(id, dto)`, `setLabor(id, dto)`.

- [ ] **Step 1: DTOs**

`backend/src/visits/dto/geo.dto.ts`:

```ts
import { IsNumber, IsOptional } from 'class-validator';

export class GeoDto {
  @IsOptional() @IsNumber() lat?: number;
  @IsOptional() @IsNumber() lng?: number;
}
```

`backend/src/visits/dto/labor.dto.ts`:

```ts
import { IsISO8601 } from 'class-validator';

export class LaborDto {
  @IsISO8601() laborStartAt!: string;
  @IsISO8601() laborEndAt!: string;
}
```

- [ ] **Step 2: Adicionar os testes que falham**

Acrescentar em `visits.service.spec.ts`:

```ts
describe('VisitsService.checkIn / checkOut / setLabor', () => {
  it('checkIn: exige status SCHEDULED, grava horário/GPS e vira IN_PROGRESS', async () => {
    const { service, prisma, events } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
    });
    await service.checkIn('v1', { lat: -23.5, lng: -46.6 });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        checkInLat: -23.5,
        checkInLng: -46.6,
      }),
    });
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_STARTED', { visitId: 'v1' });
  });

  it('checkIn: chamado OPEN vira IN_PROGRESS e registra STATUS_CHANGED', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
      ticket: {
        findUnique: vi.fn().mockResolvedValue({ id: 't1', status: 'OPEN' }),
        update: vi.fn(),
      },
    });
    await service.checkIn('v1', {});
    expect(prisma.ticket.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { status: 'IN_PROGRESS' },
    });
  });

  it('checkIn: rejeita visita que não está SCHEDULED', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await expect(service.checkIn('v1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('checkOut: exige status IN_PROGRESS, grava horário/GPS', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1' }) },
    });
    await service.checkOut('v1', { lat: 1, lng: 2 });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: expect.objectContaining({ checkOutLat: 1, checkOutLng: 2 }),
    });
  });

  it('checkOut: rejeita visita que não está IN_PROGRESS', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'SCHEDULED', ticketId: 't1' }) },
    });
    await expect(service.checkOut('v1', {})).rejects.toBeInstanceOf(ConflictException);
  });

  it('setLabor: rejeita fim antes do início', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1' }) },
    });
    await expect(
      service.setLabor('v1', { laborStartAt: '2026-10-01T12:00:00.000Z', laborEndAt: '2026-10-01T11:00:00.000Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('setLabor: aceita correção manual em qualquer status', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'DONE', ticketId: 't1' }) },
    });
    await service.setLabor('v1', { laborStartAt: '2026-10-01T11:00:00.000Z', laborEndAt: '2026-10-01T12:00:00.000Z' });
    expect(prisma.visit.update).toHaveBeenCalled();
  });
});
```

Também ajustar `makeDeps` (no topo do arquivo): adicionar `ticket.update: vi.fn()` já presente e `ticket.findUnique` continua mockado por caso — o segundo teste acima sobrescreve com `overrides.ticket`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: FAIL — `checkIn`/`checkOut`/`setLabor` não existem em `VisitsService`.

- [ ] **Step 4: Implementar em `visits.service.ts`**

Adicionar os métodos (depois de `cancel`):

```ts
  async checkIn(id: string, dto: GeoDto) {
    const visit = await this.mustFind(id);
    if (visit.status !== 'SCHEDULED') {
      throw new ConflictException('Visita precisa estar agendada pra dar check-in.');
    }
    const now = new Date();
    await this.prisma.visit.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        checkInAt: now,
        checkInLat: dto.lat ?? null,
        checkInLng: dto.lng ?? null,
        laborStartAt: now,
      },
    });
    await this.events.record(this.prisma, visit.ticketId, 'VISIT_STARTED', { visitId: id });

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: visit.ticketId },
      select: { status: true },
    });
    if (ticket?.status === 'OPEN') {
      await this.prisma.ticket.update({ where: { id: visit.ticketId }, data: { status: 'IN_PROGRESS' } });
      await this.events.record(this.prisma, visit.ticketId, 'STATUS_CHANGED', {
        from: 'OPEN',
        to: 'IN_PROGRESS',
      });
    }
    return this.findOne(id);
  }

  async checkOut(id: string, dto: GeoDto) {
    const visit = await this.mustFind(id);
    if (visit.status !== 'IN_PROGRESS') {
      throw new ConflictException('Visita precisa estar em andamento pra dar check-out.');
    }
    const now = new Date();
    await this.prisma.visit.update({
      where: { id },
      data: {
        checkOutAt: now,
        checkOutLat: dto.lat ?? null,
        checkOutLng: dto.lng ?? null,
        laborEndAt: now,
      },
    });
    return this.findOne(id);
  }

  async setLabor(id: string, dto: LaborDto) {
    await this.mustFind(id);
    const start = new Date(dto.laborStartAt);
    const end = new Date(dto.laborEndAt);
    if (end <= start) throw new BadRequestException('laborEndAt precisa ser depois de laborStartAt.');
    await this.prisma.visit.update({ where: { id }, data: { laborStartAt: start, laborEndAt: end } });
    return this.findOne(id);
  }
```

Adicionar os imports de `GeoDto` e `LaborDto` no topo do arquivo.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Rotas no controller**

Adicionar em `visits.controller.ts` (com os imports de `GeoDto`/`LaborDto`):

```ts
  @Post(':id/check-in')
  checkIn(@Param('id') id: string, @Body() dto: GeoDto) {
    return this.visits.checkIn(id, dto);
  }

  @Post(':id/check-out')
  checkOut(@Param('id') id: string, @Body() dto: GeoDto) {
    return this.visits.checkOut(id, dto);
  }

  @Patch(':id/labor')
  setLabor(@Param('id') id: string, @Body() dto: LaborDto) {
    return this.visits.setLabor(id, dto);
  }
```

- [ ] **Step 7: Build + testes**

Run: `npm run build && npx vitest run src/visits`
Expected: ambos verdes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/visits
git commit -m "feat(visits): check-in, check-out e apontamento de horas"
```

---

## Task 5: `VisitsService` — respostas de checklist

**Files:**
- Modify: `backend/src/visits/visits.service.ts`
- Modify: `backend/src/visits/visits.controller.ts`
- Create: `backend/src/visits/dto/set-checklist.dto.ts`
- Modify: `backend/src/visits/visits.service.spec.ts`

**Interfaces:**
- Produces: `VisitsService.setChecklist(id, dto)`.

- [ ] **Step 1: DTO**

`backend/src/visits/dto/set-checklist.dto.ts`:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

export class ChecklistAnswerInput {
  @IsString() @MinLength(1) itemId!: string;
  @IsBoolean() done!: boolean;
  @IsOptional() @IsString() note?: string;
}

export class SetChecklistDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistAnswerInput)
  answers!: ChecklistAnswerInput[];
}
```

- [ ] **Step 2: Adicionar os testes que falham**

Acrescentar em `visits.service.spec.ts` (e adicionar `checklistTemplateItem.findMany`/`visitChecklistAnswer.upsert` ao `makeDeps` base, já previstos no Step 2 da Task 3):

```ts
describe('VisitsService.setChecklist', () => {
  it('rejeita item que não pertence ao template da visita', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: 'tmpl1' }) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item1' }]) },
    });
    await expect(
      service.setChecklist('v1', { answers: [{ itemId: 'item-invalido', done: true }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita quando a visita não tem template associado', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: null }) },
    });
    await expect(service.setChecklist('v1', { answers: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('faz upsert de cada resposta válida', async () => {
    const { service, prisma } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', status: 'IN_PROGRESS', ticketId: 't1', checklistTemplateId: 'tmpl1' }) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'item1' }, { id: 'item2' }]) },
    });
    await service.setChecklist('v1', {
      answers: [
        { itemId: 'item1', done: true },
        { itemId: 'item2', done: false, note: 'sem acesso' },
      ],
    });
    expect(prisma.visitChecklistAnswer.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.visitChecklistAnswer.upsert).toHaveBeenCalledWith({
      where: { visitId_itemId: { visitId: 'v1', itemId: 'item1' } },
      create: { visitId: 'v1', itemId: 'item1', done: true, note: null },
      update: { done: true, note: null },
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: FAIL — `setChecklist` não existe.

- [ ] **Step 4: Implementar em `visits.service.ts`**

```ts
  async setChecklist(id: string, dto: SetChecklistDto) {
    const visit = await this.mustFind(id);
    if (!visit.checklistTemplateId) {
      throw new BadRequestException('Visita sem checklist associado.');
    }
    const items = await this.prisma.checklistTemplateItem.findMany({
      where: { templateId: visit.checklistTemplateId },
      select: { id: true },
    });
    const validItemIds = new Set(items.map((i) => i.id));
    for (const answer of dto.answers) {
      if (!validItemIds.has(answer.itemId)) {
        throw new BadRequestException(`Item de checklist inválido: ${answer.itemId}`);
      }
    }
    for (const answer of dto.answers) {
      await this.prisma.visitChecklistAnswer.upsert({
        where: { visitId_itemId: { visitId: id, itemId: answer.itemId } },
        create: { visitId: id, itemId: answer.itemId, done: answer.done, note: answer.note ?? null },
        update: { done: answer.done, note: answer.note ?? null },
      });
    }
    return this.findOne(id);
  }
```

Adicionar o import de `SetChecklistDto` no topo do arquivo.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Rota no controller**

```ts
  @Put(':id/checklist')
  setChecklist(@Param('id') id: string, @Body() dto: SetChecklistDto) {
    return this.visits.setChecklist(id, dto);
  }
```

Adicionar `Put` ao import de `@nestjs/common` e `SetChecklistDto` ao import de DTOs.

- [ ] **Step 7: Build + testes**

Run: `npm run build && npx vitest run src/visits`
Expected: ambos verdes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/visits
git commit -m "feat(visits): respostas de checklist da visita"
```

---

## Task 6: Anexos de visita (fotos e assinatura)

**Files:**
- Modify: `backend/src/tickets/tickets.service.ts` (`publicAttachment` ganha `kind`/`visitId`/`assetId`)
- Modify: `backend/src/attachments/attachments.service.ts` (`saveForVisit`, `listForVisit`, branch de acesso no `getForDownload`, `persist` aceita `kind`)
- Modify: `backend/src/attachments/attachments.controller.ts` (rotas `visits/:id/attachments`)
- Modify: `backend/src/attachments/attachments.service.spec.ts`

**Interfaces:**
- Consumes: `Attachment.visitId`/`Attachment.kind` (Task 1).
- Produces: `AttachmentsService.saveForVisit(visitId, file, actor, kind)`, `listForVisit(visitId)` — consumidos pelo frontend (Task 14) e por `VisitsService.close` (Task 8, valida assinatura via `prisma.attachment.count`).

- [ ] **Step 1: `publicAttachment` ganha os campos novos**

Em `backend/src/tickets/tickets.service.ts`, trocar a função:

```ts
export function publicAttachment(a: {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: Date;
  ticketId: string | null;
  commentId: string | null;
  assetId?: string | null;
  visitId?: string | null;
  kind?: string;
}) {
  return {
    id: a.id,
    filename: a.filename,
    mime: a.mime,
    size: a.size,
    createdAt: a.createdAt,
    ticketId: a.ticketId,
    commentId: a.commentId,
    assetId: a.assetId ?? null,
    visitId: a.visitId ?? null,
    kind: a.kind ?? 'GENERIC',
  };
}
```

- [ ] **Step 2: Adicionar os testes que falham em `attachments.service.spec.ts`**

Adicionar `visit: { findUnique: vi.fn() }` ao objeto `prisma` de `makeDeps()`, e os testes:

```ts
describe('AttachmentsService.saveForVisit', () => {
  it('404 se a visita não existe', async () => {
    const { service, prisma } = makeDeps();
    prisma.visit.findUnique.mockResolvedValue(null);
    await expect(service.saveForVisit('nope', png(), actor, 'SIGNATURE')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('grava com `visitId` e o `kind` informado', async () => {
    const { service, prisma } = makeDeps();
    prisma.visit.findUnique.mockResolvedValue({ id: 'v1' });
    const result = await service.saveForVisit('v1', png(), actor, 'SIGNATURE');
    expect(prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ visitId: 'v1', kind: 'SIGNATURE' }) }),
    );
    expect(result.kind).toBe('SIGNATURE');
  });
});

describe('AttachmentsService.getForDownload — anexo de visita', () => {
  it('cliente não baixa anexo de visita (recurso interno)', async () => {
    const { service, prisma } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({ id: 'at1', ticketId: null, commentId: null, assetId: null, visitId: 'v1' });
    await expect(
      service.getForDownload('at1', { id: 'c1', type: 'CLIENT', role: 'CONTACT', clientId: 'cli1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('agente baixa anexo de visita', async () => {
    const { service, prisma } = makeDeps();
    const att = { id: 'at1', ticketId: null, commentId: null, assetId: null, visitId: 'v1' };
    prisma.attachment.findUnique.mockResolvedValue(att);
    await expect(service.getForDownload('at1', actor)).resolves.toBe(att);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run src/attachments/attachments.service.spec.ts`
Expected: FAIL — `saveForVisit` não existe; `prisma.visit` ausente do mock quebra o teste de acesso.

- [ ] **Step 4: Implementar em `attachments.service.ts`**

Trocar a assinatura de `persist` pra aceitar `visitId` e `kind`, e adicionar os dois métodos novos:

```ts
  async saveForVisit(
    visitId: string,
    file: UploadedFile,
    actor: Actor,
    kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE',
  ): Promise<ReturnType<typeof publicAttachment>> {
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId }, select: { id: true } });
    if (!visit) throw new NotFoundException('Visita não encontrada.');
    return publicAttachment(await this.persist({ visitId }, file, actor, kind));
  }

  listForVisit(visitId: string) {
    return this.prisma.attachment
      .findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map(publicAttachment));
  }
```

Trocar a assinatura de `persist`:

```ts
  private async persist(
    link: { ticketId: string } | { commentId: string } | { assetId: string } | { visitId: string },
    file: UploadedFile,
    actor?: Actor,
    kind: 'GENERIC' | 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' | 'REPORT' = 'GENERIC',
  ): Promise<Attachment> {
    if (!file) throw new BadRequestException('Arquivo ausente.');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Arquivo excede o limite de 10 MB.');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}.`);
    }

    const key = `attachments/${storedName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    return this.prisma.attachment.create({
      data: {
        ...link,
        kind,
        filename: file.originalname,
        storedPath: key,
        mime: file.mimetype,
        size: file.size,
        uploadedById: actor?.id as string,
      },
    });
  }
```

(As chamadas existentes — `saveForTicket`, `saveForComment`, `saveForAsset` — continuam passando só 3 argumentos; `kind` cai no default `'GENERIC'`.)

E o branch de acesso interno em `getForDownload` — adicionar antes do `if (!ticketId) throw new NotFoundException(...)`:

```ts
    // Anexo de visita: recurso interno (fotos/assinatura). Cliente nunca baixa.
    if (!ticketId && !attachment.commentId && !attachment.assetId && attachment.visitId) {
      if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
      return attachment;
    }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/attachments/attachments.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Rotas no controller**

Em `attachments.controller.ts`, adicionar (mesmo padrão de `assets/:id/attachments`):

```ts
  @Post('visits/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  @UseInterceptors(interceptor)
  uploadToVisit(
    @Param('id') id: string,
    @Query('kind') kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE',
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    if (!['PHOTO_BEFORE', 'PHOTO_AFTER', 'SIGNATURE'].includes(kind)) {
      throw new BadRequestException('kind inválido — use PHOTO_BEFORE, PHOTO_AFTER ou SIGNATURE.');
    }
    return this.attachments.saveForVisit(id, file, actor, kind);
  }

  @Get('visits/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  listForVisit(@Param('id') id: string) {
    return this.attachments.listForVisit(id);
  }
```

Adicionar `BadRequestException` e `Query` aos imports de `@nestjs/common`.

- [ ] **Step 7: Build + testes**

Run: `npm run build && npx vitest run src/attachments src/tickets`
Expected: todos verdes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/tickets/tickets.service.ts backend/src/attachments
git commit -m "feat(visits): anexos de visita (fotos e assinatura)"
```

---

## Task 7: `VisitReportService` — laudo em PDF + e-mail

**Files:**
- Modify: `backend/package.json` (dependência `pdfkit`)
- Create: `backend/src/visits/visit-pdf.ts`
- Modify: `backend/src/visits/visit-report.service.ts` (substitui o stub da Task 3)
- Create: `backend/src/visits/visit-report.service.spec.ts`

**Interfaces:**
- Consumes: `StorageService` (`../storage/storage.service.js`), `EmailService` (`../email/email.service.js`, incl. `brand()`), `escapeHtml` (`../email/templates.js`).
- Produces: `VisitReportService.generate(visitId): Promise<Attachment>`, `sendEmail(visitId, attachment): Promise<void>` — consumidos por `VisitsService.close`/`resendReport` (Task 8).

- [ ] **Step 1: Instalar `pdfkit`**

Run (em `C:/Users/renan/os-exec/backend`):

```bash
npm install pdfkit
npm install -D @types/pdfkit
```

Expected: `pdfkit` e `@types/pdfkit` em `dependencies`/`devDependencies` do `package.json`.

- [ ] **Step 2: `visit-pdf.ts` — montagem do PDF (função pura, testável sem I/O)**

```ts
import PDFDocument from 'pdfkit';
import type { BrandInfo } from '../email/templates.js';

export interface VisitPdfInput {
  ticket: { number: string; title: string; client: { name: string } | null; location: { name: string } | null };
  technician: { name: string };
  scheduledStart: Date;
  scheduledEnd: Date;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  laborStartAt: Date | null;
  laborEndAt: Date | null;
  notes: string | null;
  checklistItems: { id: string; label: string }[];
  checklistAnswers: { itemId: string; done: boolean; note: string | null }[];
  brand: BrandInfo;
  signatureBuffer?: Buffer;
}

function fmt(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'UTC' });
}

/** Gera o PDF do laudo de atendimento. Não falha com dados ausentes (observação vazia, sem fotos). */
export function buildVisitPdf(input: VisitPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text(input.brand.companyName ?? 'Laudo de atendimento');
    doc.moveDown();
    doc.fontSize(12).text(`Chamado #${input.ticket.number} — ${input.ticket.title}`);
    if (input.ticket.client?.name) doc.text(`Cliente: ${input.ticket.client.name}`);
    if (input.ticket.location?.name) doc.text(`Local: ${input.ticket.location.name}`);
    doc.text(`Técnico: ${input.technician.name}`);
    doc.moveDown();
    doc.text(`Agendado: ${fmt(input.scheduledStart)} — ${fmt(input.scheduledEnd)}`);
    if (input.checkInAt) doc.text(`Check-in: ${fmt(input.checkInAt)}`);
    if (input.checkOutAt) doc.text(`Check-out: ${fmt(input.checkOutAt)}`);
    if (input.laborStartAt && input.laborEndAt) {
      const minutes = Math.round((input.laborEndAt.getTime() - input.laborStartAt.getTime()) / 60000);
      doc.text(`Horas trabalhadas: ${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`);
    }

    doc.moveDown();
    doc.fontSize(13).text('Checklist');
    doc.fontSize(11);
    const answers = new Map(input.checklistAnswers.map((a) => [a.itemId, a]));
    for (const item of input.checklistItems) {
      const a = answers.get(item.id);
      doc.text(`${a?.done ? '[x]' : '[ ]'} ${item.label}${a?.note ? ` — ${a.note}` : ''}`);
    }

    if (input.notes) {
      doc.moveDown();
      doc.fontSize(13).text('Observações');
      doc.fontSize(11).text(input.notes);
    }

    if (input.signatureBuffer) {
      doc.moveDown();
      doc.fontSize(13).text('Assinatura do cliente');
      doc.image(input.signatureBuffer, { fit: [200, 100] });
    }

    doc.moveDown();
    doc.fontSize(9).fillColor('#888888').text(`Emitido em ${fmt(new Date())}`);
    doc.end();
  });
}
```

- [ ] **Step 3: Escrever o teste que falha**

`backend/src/visits/visit-report.service.spec.ts`:

```ts
import { VisitReportService } from './visit-report.service.js';

const baseVisit = {
  id: 'v1',
  ticketId: 't1',
  technicianId: 'tech1',
  scheduledStart: new Date('2026-10-01T13:00:00.000Z'),
  scheduledEnd: new Date('2026-10-01T14:00:00.000Z'),
  checkInAt: new Date('2026-10-01T13:05:00.000Z'),
  checkOutAt: new Date('2026-10-01T13:50:00.000Z'),
  laborStartAt: new Date('2026-10-01T13:05:00.000Z'),
  laborEndAt: new Date('2026-10-01T13:50:00.000Z'),
  notes: null,
  ticket: { id: 't1', number: '2026-0001', title: 'Sem imagem', client: { name: 'Cliente X' }, location: null },
  technician: { name: 'Fulano' },
  checklistTemplate: { items: [{ id: 'i1', label: 'Energia ok' }] },
  checklistAnswers: [{ itemId: 'i1', done: true, note: null }],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    visit: { findUnique: vi.fn().mockResolvedValue(baseVisit) },
    attachment: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'rep1', ...data })),
    },
    user: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  const storage = { put: vi.fn().mockResolvedValue(undefined), readable: vi.fn() };
  const email = {
    send: vi.fn().mockResolvedValue(undefined),
    brand: vi.fn().mockResolvedValue({ companyName: 'OneDay' }),
  };
  const service = new VisitReportService(prisma as any, storage as any, email as any);
  return { service, prisma, storage, email };
}

describe('VisitReportService.generate', () => {
  it('gera o PDF, grava no storage e cria o Attachment com ticketId + visitId + kind REPORT', async () => {
    const { service, storage, prisma } = makeDeps();
    const attachment = await service.generate('v1');
    expect(storage.put).toHaveBeenCalledWith(
      expect.stringContaining('visit-reports/'),
      expect.any(Buffer),
      'application/pdf',
    );
    expect(prisma.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ticketId: 't1', visitId: 'v1', kind: 'REPORT', mime: 'application/pdf' }),
      }),
    );
    expect(attachment.kind).toBe('REPORT');
  });
});

describe('VisitReportService.sendEmail', () => {
  it('envia pro solicitante e pros MANAGER do cliente, com link do chamado', async () => {
    const { service, prisma, email } = makeDeps({
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'req1', email: 'solicitante@x.test' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'mgr1', email: 'gestor@x.test' }]),
      },
    });
    prisma.visit.findUnique.mockResolvedValue({
      ...baseVisit,
      ticket: { ...baseVisit.ticket, clientId: 'cli1', requesterId: 'req1' },
    });
    await service.sendEmail('v1', { id: 'rep1' } as any);
    expect(email.send).toHaveBeenCalledTimes(2);
    const [args] = email.send.mock.calls[0];
    expect(args.html).toContain('/portal/chamados/t1');
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run src/visits/visit-report.service.spec.ts`
Expected: FAIL — o stub da Task 3 lança "ainda não implementado".

- [ ] **Step 5: Implementar `visit-report.service.ts`**

```ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { EmailService } from '../email/email.service.js';
import { escapeHtml } from '../email/templates.js';
import { buildVisitPdf } from './visit-pdf.js';

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(c as Buffer));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

@Injectable()
export class VisitReportService {
  private readonly logger = new Logger('VisitReportService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly email: EmailService,
  ) {}

  async generate(visitId: string): Promise<Attachment> {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        ticket: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { name: true } },
            location: { select: { name: true } },
          },
        },
        technician: { select: { name: true } },
        checklistTemplate: { include: { items: { orderBy: { order: 'asc' } } } },
        checklistAnswers: true,
      },
    });
    if (!visit) throw new NotFoundException('Visita não encontrada.');

    const signature = await this.prisma.attachment.findFirst({
      where: { visitId, kind: 'SIGNATURE' },
      orderBy: { createdAt: 'desc' },
    });
    let signatureBuffer: Buffer | undefined;
    if (signature) {
      const obj = await this.storage.readable(signature.storedPath);
      signatureBuffer = await streamToBuffer(obj.stream);
    }

    const brand = await this.email.brand();
    const buffer = await buildVisitPdf({
      ticket: visit.ticket,
      technician: visit.technician,
      scheduledStart: visit.scheduledStart,
      scheduledEnd: visit.scheduledEnd,
      checkInAt: visit.checkInAt,
      checkOutAt: visit.checkOutAt,
      laborStartAt: visit.laborStartAt,
      laborEndAt: visit.laborEndAt,
      notes: visit.notes,
      checklistItems: visit.checklistTemplate?.items ?? [],
      checklistAnswers: visit.checklistAnswers,
      brand,
      signatureBuffer,
    });

    const key = `visit-reports/${visitId}-${Date.now()}.pdf`;
    await this.storage.put(key, buffer, 'application/pdf');

    return this.prisma.attachment.create({
      data: {
        ticketId: visit.ticket.id,
        visitId,
        kind: 'REPORT',
        filename: `laudo-${visit.ticket.number}.pdf`,
        storedPath: key,
        mime: 'application/pdf',
        size: buffer.length,
        uploadedById: visit.technicianId,
      },
    });
  }

  async sendEmail(visitId: string, _attachment: Attachment): Promise<void> {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
      select: {
        ticket: { select: { id: true, number: true, title: true, clientId: true, requesterId: true } },
      },
    });
    if (!visit) return;
    const { ticket } = visit;

    const recipients = new Map<string, string>();
    if (ticket.requesterId) {
      const requester = await this.prisma.user.findUnique({ where: { id: ticket.requesterId } });
      if (requester) recipients.set(requester.id, requester.email);
    }
    if (ticket.clientId) {
      const managers = await this.prisma.user.findMany({
        where: { clientId: ticket.clientId, role: 'MANAGER', active: true },
      });
      for (const m of managers) recipients.set(m.id, m.email);
    }

    const appUrl = process.env.APP_URL ?? '';
    const link = `${appUrl}/portal/chamados/${ticket.id}`;
    for (const to of recipients.values()) {
      await this.email.send({
        to,
        subject: `Laudo de atendimento — chamado #${ticket.number}`,
        html:
          `<p>O atendimento do chamado <strong>#${escapeHtml(ticket.number)} — ${escapeHtml(ticket.title)}</strong> foi concluído.</p>` +
          `<p>O laudo está disponível no chamado: <a href="${link}">${link}</a></p>`,
      });
    }
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run src/visits/visit-report.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Build + testes**

Run: `npm run build && npx vitest run src/visits`
Expected: ambos verdes (`VisitsService` continua injetando o `VisitReportService` real agora).

- [ ] **Step 8: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/visits
git commit -m "feat(visits): laudo em PDF (pdfkit) e envio por e-mail"
```

---

## Task 8: `VisitsService.close` + reenvio de laudo

**Files:**
- Modify: `backend/src/visits/visits.service.ts`
- Modify: `backend/src/visits/visits.controller.ts`
- Modify: `backend/src/visits/visits.service.spec.ts`

**Interfaces:**
- Produces: `VisitsService.close(id)`, `resendReport(id)`. Rotas `POST /visits/:id/close`, `POST /visits/:id/report/resend`.

- [ ] **Step 1: Adicionar os testes que falham**

```ts
describe('VisitsService.close', () => {
  function readyVisit(over: Record<string, unknown> = {}) {
    return {
      id: 'v1',
      status: 'IN_PROGRESS',
      ticketId: 't1',
      checkOutAt: new Date(),
      checklistTemplateId: 'tmpl1',
      ...over,
    };
  }

  it('recusa sem checkout, checklist incompleto ou sem assinatura', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit({ checkOutAt: null })) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
      visitChecklistAnswer: { count: vi.fn().mockResolvedValue(0) },
      attachment: { count: vi.fn().mockResolvedValue(0) },
    });
    await expect(service.close('v1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fecha quando tudo presente: status DONE, evento e laudo enviado', async () => {
    const { service, prisma, events, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit()) },
      checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
      visitChecklistAnswer: { count: vi.fn().mockResolvedValue(1) },
      attachment: { count: vi.fn().mockResolvedValue(1) },
    });
    await service.close('v1');
    expect(prisma.visit.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'DONE' } });
    expect(events.record).toHaveBeenCalledWith(prisma, 't1', 'VISIT_COMPLETED', { visitId: 'v1' });
    expect(report.generate).toHaveBeenCalledWith('v1');
    expect(report.sendEmail).toHaveBeenCalled();
  });

  it('fecha mesmo se o laudo falhar ao gerar/enviar (não propaga)', async () => {
    const report = { generate: vi.fn().mockRejectedValue(new Error('storage fora')), sendEmail: vi.fn() };
    const { service, prisma } = makeDeps(
      {
        visit: { findUnique: vi.fn().mockResolvedValue(readyVisit()) },
        checklistTemplateItem: { findMany: vi.fn().mockResolvedValue([{ id: 'i1' }]) },
        visitChecklistAnswer: { count: vi.fn().mockResolvedValue(1) },
        attachment: { count: vi.fn().mockResolvedValue(1) },
      },
    );
    // troca o report mockado depois do makeDeps pra simular a falha
    (service as any).report = report;
    await expect(service.close('v1')).resolves.toBeDefined();
    expect(prisma.visit.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { status: 'DONE' } });
  });

  it('recusa fechar visita que não está IN_PROGRESS', async () => {
    const { service } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue(readyVisit({ status: 'SCHEDULED' })) },
    });
    await expect(service.close('v1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('VisitsService.resendReport', () => {
  it('reaproveita o Attachment REPORT existente e reenvia', async () => {
    const { service, prisma, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', ticketId: 't1' }) },
      attachment: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ id: 'rep1', kind: 'REPORT' }),
      },
    });
    await service.resendReport('v1');
    expect(report.generate).not.toHaveBeenCalled();
    expect(report.sendEmail).toHaveBeenCalledWith('v1', { id: 'rep1', kind: 'REPORT' });
    expect(prisma.visit.update).toHaveBeenCalledWith({
      where: { id: 'v1' },
      data: { reportSentAt: expect.any(Date) },
    });
  });

  it('gera o laudo se ainda não existir', async () => {
    const { service, report } = makeDeps({
      visit: { findUnique: vi.fn().mockResolvedValue({ id: 'v1', ticketId: 't1' }) },
      attachment: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null) },
    });
    report.generate.mockResolvedValue({ id: 'rep2', kind: 'REPORT' });
    await service.resendReport('v1');
    expect(report.generate).toHaveBeenCalledWith('v1');
    expect(report.sendEmail).toHaveBeenCalledWith('v1', { id: 'rep2', kind: 'REPORT' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: FAIL — `close`/`resendReport` não existem.

- [ ] **Step 3: Implementar em `visits.service.ts`**

```ts
  async close(id: string) {
    const visit = await this.mustFind(id);
    if (visit.status !== 'IN_PROGRESS') {
      throw new ConflictException('Visita precisa estar em andamento pra fechar.');
    }

    const missing: string[] = [];
    if (!visit.checkOutAt) missing.push('checkout');

    if (!visit.checklistTemplateId) {
      missing.push('checklist');
    } else {
      const items = await this.prisma.checklistTemplateItem.findMany({
        where: { templateId: visit.checklistTemplateId },
        select: { id: true },
      });
      const answered = await this.prisma.visitChecklistAnswer.count({ where: { visitId: id } });
      if (answered < items.length) missing.push('checklist');
    }

    const hasSignature = await this.prisma.attachment.count({ where: { visitId: id, kind: 'SIGNATURE' } });
    if (!hasSignature) missing.push('signature');

    if (missing.length) {
      throw new BadRequestException({ message: 'Visita incompleta para fechar.', missing });
    }

    await this.prisma.visit.update({ where: { id }, data: { status: 'DONE' } });
    await this.events.record(this.prisma, visit.ticketId, 'VISIT_COMPLETED', { visitId: id });

    try {
      const attachment = await this.report.generate(id);
      await this.report.sendEmail(id, attachment);
      await this.prisma.visit.update({ where: { id }, data: { reportSentAt: new Date() } });
    } catch (err) {
      this.logger.warn(`laudo da visita ${id} falhou: ${(err as Error).message}`);
    }

    return this.findOne(id);
  }

  async resendReport(id: string) {
    await this.mustFind(id);
    let attachment = await this.prisma.attachment.findFirst({
      where: { visitId: id, kind: 'REPORT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!attachment) attachment = await this.report.generate(id);
    await this.report.sendEmail(id, attachment);
    await this.prisma.visit.update({ where: { id }, data: { reportSentAt: new Date() } });
    return this.findOne(id);
  }
```

Adicionar `private readonly logger = new Logger('VisitsService');` como propriedade da classe e `Logger` ao import de `@nestjs/common`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/visits/visits.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Rotas no controller**

```ts
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.visits.close(id);
  }

  @Post(':id/report/resend')
  resendReport(@Param('id') id: string) {
    return this.visits.resendReport(id);
  }
```

- [ ] **Step 6: Build + testes**

Run: `npm run build && npx vitest run src/visits`
Expected: ambos verdes.

- [ ] **Step 7: Commit**

```bash
git add backend/src/visits
git commit -m "feat(visits): fechamento da visita e reenvio do laudo"
```

---

## Task 9: Integração — ciclo de vida completo (Postgres real)

**Files:**
- Create: `backend/src/visits/visits.integration.spec.ts`

**Interfaces:**
- Consumes: toda a stack de `visits` + `checklist-templates` + `attachments` + Prisma real.

- [ ] **Step 1: Escrever o teste de integração**

```ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailService } from '../email/email.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { ChecklistTemplatesService } from '../checklist-templates/checklist-templates.service.js';
import { VisitsService } from './visits.service.js';
import { VisitReportService } from './visit-report.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Ciclo completo agendar → check-in →
// checklist → assinatura → check-out → fechar → laudo. Sobe com
// `docker compose up -d postgres`. Sem banco no ar, pula com aviso (exit 0).
const PFX = `AGD-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.visit.deleteMany({ where: { ticket: { number: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.checklistTemplate.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Visits — ciclo de vida completo (Postgres real)', () => {
  let visits: VisitsService;
  let sentEmails: { to: string; subject: string }[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[visits.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const passwordHash = await bcrypt.hash('senha12345', 10);
    const requester = await prisma.user.create({
      data: { name: 'Contato', email: `contato@${EMAIL_DOMAIN}`, passwordHash, type: 'CLIENT', role: 'CONTACT', clientId: client.id },
    });
    const technician = await prisma.user.create({
      data: { name: 'Técnico', email: `tecnico@${EMAIL_DOMAIN}`, passwordHash, type: 'INTERNAL', role: 'AGENT' },
    });
    const ticket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado de teste',
        description: 'desc',
        clientId: client.id,
        requesterId: requester.id,
        origin: 'MANUAL',
        status: 'OPEN',
      },
    });
    id.clientId = client.id;
    id.requesterId = requester.id;
    id.technicianId = technician.id;
    id.ticketId = ticket.id;

    const prismaService = prisma as unknown as PrismaService;
    const settings = new SettingsService(prismaService);
    const storage = new StorageService(settings);
    const email = new EmailService(settings);
    // Postgres real, e-mail fake: intercepta `send` pra não depender de Resend.
    (email as unknown as { send: typeof email.send }).send = async (input) => {
      sentEmails.push({ to: input.to, subject: input.subject });
    };
    const events = new TicketEventsService();
    const templates = new ChecklistTemplatesService(prismaService);
    await templates.onModuleInit();
    const report = new VisitReportService(prismaService, storage, email);
    visits = new VisitsService(prismaService, events, templates, report);
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('agenda, executa e fecha a visita, com laudo enviado', async () => {
    if (!available) return;

    const created = await visits.create({
      ticketId: id.ticketId,
      technicianId: id.technicianId,
      scheduledStart: new Date(Date.now() + 3600_000).toISOString(),
      scheduledEnd: new Date(Date.now() + 7200_000).toISOString(),
    });
    expect(created.status).toBe('SCHEDULED');
    expect(created.checklistTemplate).toBeTruthy();

    const started = await visits.checkIn(created.id, {});
    expect(started.status).toBe('IN_PROGRESS');
    const ticketAfterCheckIn = await prisma!.ticket.findUnique({ where: { id: id.ticketId } });
    expect(ticketAfterCheckIn?.status).toBe('IN_PROGRESS');

    const items = created.checklistTemplate.items as { id: string }[];
    await visits.setChecklist(created.id, {
      answers: items.map((i: { id: string }) => ({ itemId: i.id, done: true })),
    });

    await prisma!.attachment.create({
      data: {
        visitId: created.id,
        kind: 'SIGNATURE',
        filename: 'assinatura.png',
        storedPath: `attachments/${PFX}-assinatura.png`,
        mime: 'image/png',
        size: 10,
        uploadedById: id.technicianId,
      },
    });
    await prisma!.$executeRawUnsafe(
      `SELECT 1`, // no-op: garante que a conexão segue viva antes do storage.put a seguir
    );
    await storageIsReady();

    await visits.checkOut(created.id, {});

    const closed = await visits.close(created.id);
    expect(closed.status).toBe('DONE');
    expect(sentEmails.length).toBeGreaterThan(0);
    expect(sentEmails[0].subject).toContain(`${PFX}-0001`);

    const reportAttachment = await prisma!.attachment.findFirst({
      where: { visitId: created.id, kind: 'REPORT' },
    });
    expect(reportAttachment).toBeTruthy();
    expect(reportAttachment?.ticketId).toBe(id.ticketId);
  });

  async function storageIsReady() {
    // A assinatura de teste não é um PNG real e não passa pelo StorageService —
    // pra `VisitReportService.generate` não travar tentando ler o arquivo do
    // disco, o teste sobe o PNG real via `storage.put` diretamente.
    const buf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const settings = new SettingsService(prisma as unknown as PrismaService);
    const storage = new StorageService(settings);
    await storage.put(`attachments/${PFX}-assinatura.png`, buf, 'image/png');
  }
});
```

- [ ] **Step 2: Rodar**

Run: `npm run test:integration -- visits.integration`
Expected: PASS com Postgres local (`docker compose up -d postgres`); pula com aviso sem banco.

- [ ] **Step 3: Commit**

```bash
git add backend/src/visits/visits.integration.spec.ts
git commit -m "test(visits): integração do ciclo de vida completo da visita"
```

---

## Task 10: Frontend — `lib/visits.ts`

**Files:**
- Create: `frontend/src/lib/visits.ts`
- Modify: `frontend/src/lib/tickets.ts` (`Attachment` ganha `kind`/`visitId`/`assetId`; `TicketEvent['type']` ganha os 4 valores novos)

**Interfaces:**
- Produces: tipos `Visit`, `VisitStatus`, `ChecklistTemplate`; hooks `useVisits(filter)`, `useVisit(id)`, `useScheduleVisit()`, `useRescheduleVisit(id)`, `useCancelVisit(id)`, `useCheckIn(id)`, `useCheckOut(id)`, `useSetChecklist(id)`, `useCloseVisit(id)`, `useUploadVisitAttachment(id)`; `VISIT_STATUS_LABELS`.

- [ ] **Step 1: Ajustar `frontend/src/lib/tickets.ts`**

No `Attachment`, adicionar os campos novos:

```ts
export interface Attachment {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
  kind?: 'GENERIC' | 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' | 'REPORT';
  visitId?: string | null;
  assetId?: string | null;
}
```

No `TicketEvent['type']`, adicionar:

```ts
    | 'VISIT_SCHEDULED'
    | 'VISIT_STARTED'
    | 'VISIT_COMPLETED'
    | 'VISIT_CANCELLED';
```

- [ ] **Step 2: `frontend/src/lib/visits.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Attachment } from './tickets';

export type VisitStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  SCHEDULED: 'Agendada',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluída',
  CANCELLED: 'Cancelada',
};

export interface ChecklistTemplateItem {
  id: string;
  label: string;
  order: number;
}

export interface ChecklistTemplate {
  id: string;
  categoryId: string | null;
  name: string;
  active: boolean;
  items: ChecklistTemplateItem[];
}

export interface ChecklistAnswer {
  itemId: string;
  done: boolean;
  note: string | null;
}

export interface Visit {
  id: string;
  status: VisitStatus;
  scheduledStart: string;
  scheduledEnd: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  laborStartAt: string | null;
  laborEndAt: string | null;
  notes: string | null;
  reportSentAt: string | null;
  ticket: { id: string; number: string; title: string; client: { id: string; name: string } | null; location: { id: string; name: string } | null };
  technician: { id: string; name: string };
  checklistTemplate: ChecklistTemplate | null;
  checklistAnswers: ChecklistAnswer[];
  attachments: Attachment[];
}

export interface VisitFilters {
  technicianId?: string;
  date?: string;
  status?: VisitStatus;
  ticketId?: string;
}

function toQuery(f: VisitFilters): string {
  const p = new URLSearchParams();
  if (f.technicianId) p.set('technicianId', f.technicianId);
  if (f.date) p.set('date', f.date);
  if (f.status) p.set('status', f.status);
  if (f.ticketId) p.set('ticketId', f.ticketId);
  return p.toString();
}

export function useVisits(filter: VisitFilters) {
  return useQuery({
    queryKey: ['visits', filter],
    queryFn: () => api<Visit[]>(`/visits?${toQuery(filter)}`),
  });
}

export function useVisit(id: string) {
  return useQuery({
    queryKey: ['visit', id],
    queryFn: () => api<Visit>(`/visits/${id}`),
    enabled: !!id,
  });
}

function useVisitMutation<TArgs, TData = Visit>(id: string | undefined, fn: (args: TArgs) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      if (id) qc.invalidateQueries({ queryKey: ['visit', id] });
      qc.invalidateQueries({ queryKey: ['visits'] });
    },
  });
}

export function useScheduleVisit() {
  return useVisitMutation<{ ticketId: string; technicianId: string; scheduledStart: string; scheduledEnd: string }>(
    undefined,
    (body) => api('/visits', { method: 'POST', body }),
  );
}

export function useRescheduleVisit(id: string) {
  return useVisitMutation<{ technicianId?: string; scheduledStart?: string; scheduledEnd?: string }>(
    id,
    (body) => api(`/visits/${id}`, { method: 'PATCH', body }),
  );
}

export function useCancelVisit(id: string) {
  return useVisitMutation<void>(id, () => api(`/visits/${id}/cancel`, { method: 'POST' }));
}

export function useCheckIn(id: string) {
  return useVisitMutation<{ lat?: number; lng?: number }>(id, (body) =>
    api(`/visits/${id}/check-in`, { method: 'POST', body }),
  );
}

export function useCheckOut(id: string) {
  return useVisitMutation<{ lat?: number; lng?: number }>(id, (body) =>
    api(`/visits/${id}/check-out`, { method: 'POST', body }),
  );
}

export function useSetLabor(id: string) {
  return useVisitMutation<{ laborStartAt: string; laborEndAt: string }>(id, (body) =>
    api(`/visits/${id}/labor`, { method: 'PATCH', body }),
  );
}

export function useSetChecklist(id: string) {
  return useVisitMutation<{ answers: { itemId: string; done: boolean; note?: string }[] }>(id, (body) =>
    api(`/visits/${id}/checklist`, { method: 'PUT', body }),
  );
}

export function useCloseVisit(id: string) {
  return useVisitMutation<void>(id, () => api(`/visits/${id}/close`, { method: 'POST' }));
}

export function useUploadVisitAttachment(id: string) {
  return useVisitMutation<{ file: File; kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' }>(
    id,
    ({ file, kind }) => {
      const fd = new FormData();
      fd.append('file', file);
      return api(`/visits/${id}/attachments?kind=${kind}`, { method: 'POST', body: fd });
    },
  );
}
```

- [ ] **Step 3: Build de sanidade do frontend**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/visits.ts frontend/src/lib/tickets.ts
git commit -m "feat(frontend): tipos e hooks de visitas"
```

---

## Task 11: Frontend — `/app/agenda`

**Files:**
- Create: `frontend/src/app/app/agenda/page.tsx`

**Interfaces:**
- Consumes: `useVisits`, `useScheduleVisit`, `useRescheduleVisit`, `useCancelVisit` (Task 10); `useSession` (`@/lib/auth`); `PublicUser` (`@/lib/tickets`).

- [ ] **Step 1: `page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { type PublicUser, type Paged, type TicketListItem } from '@/lib/tickets';
import {
  VISIT_STATUS_LABELS,
  useCancelVisit,
  useRescheduleVisit,
  useScheduleVisit,
  useVisits,
  type Visit,
} from '@/lib/visits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function statusTone(s: Visit['status']) {
  return s === 'DONE' ? 'green' : s === 'IN_PROGRESS' ? 'amber' : s === 'CANCELLED' ? 'neutral' : 'blue';
}

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const [ticketId, setTicketId] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const schedule = useScheduleVisit();

  const { data: tickets } = useQuery({
    queryKey: ['tickets', 'agenda-picker'],
    queryFn: () => api<Paged<TicketListItem>>('/tickets?pageSize=50'),
  });
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ticketId || !technicianId || !date) {
          toast.error('Preencha chamado, técnico e data.');
          return;
        }
        schedule.mutate(
          {
            ticketId,
            technicianId,
            scheduledStart: new Date(`${date}T${start}:00`).toISOString(),
            scheduledEnd: new Date(`${date}T${end}:00`).toISOString(),
          },
          {
            onSuccess: () => {
              toast.success('Visita agendada.');
              onDone();
            },
            onError: onErr,
          },
        );
      }}
    >
      <Select className="h-9 w-56" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
        <option value="">Chamado…</option>
        {tickets?.data.map((t) => (
          <option key={t.id} value={t.id}>
            #{t.number} {t.title}
          </option>
        ))}
      </Select>
      <Select className="h-9 w-40" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
        <option value="">Técnico…</option>
        {agents?.filter((a) => a.role === 'AGENT' && a.active).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
      <Input type="time" className="h-9 w-28" value={start} onChange={(e) => setStart(e.target.value)} />
      <Input type="time" className="h-9 w-28" value={end} onChange={(e) => setEnd(e.target.value)} />
      <Button type="submit" className="h-9" disabled={schedule.isPending}>
        Agendar visita
      </Button>
    </form>
  );
}

export default function AgendaPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [technicianId, setTechnicianId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const { data: visits, isLoading } = useVisits({ date, technicianId: technicianId || undefined });
  const { data: agents } = useQuery({
    queryKey: ['users', 'INTERNAL'],
    queryFn: () => api<PublicUser[]>('/users?type=INTERNAL'),
  });

  const byTechnician = new Map<string, Visit[]>();
  for (const v of visits ?? []) {
    const list = byTechnician.get(v.technician.id) ?? [];
    list.push(v);
    byTechnician.set(v.technician.id, list);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Agenda</h1>
        <Button variant="outline" className="h-9" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Fechar' : 'Agendar visita'}
        </Button>
      </div>

      {showForm && <ScheduleForm onDone={() => setShowForm(false)} />}

      <div className="flex gap-2">
        <Input type="date" className="h-9 w-40" value={date} onChange={(e) => setDate(e.target.value)} />
        <Select className="h-9 w-48" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
          <option value="">Todos os técnicos</option>
          {agents?.filter((a) => a.role === 'AGENT').map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (visits?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma visita nessa data.</p>
      )}

      {[...byTechnician.entries()].map(([techId, list]) => (
        <section key={techId} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">{list[0].technician.name}</h2>
          <ul className="flex flex-col gap-1">
            {list.map((v) => (
              <VisitRow key={v.id} visit={v} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function VisitRow({ visit }: { visit: Visit }) {
  const reschedule = useRescheduleVisit(visit.id);
  const cancel = useCancelVisit(visit.id);
  const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <li className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <span className="whitespace-nowrap font-mono text-xs">
        {time(visit.scheduledStart)}–{time(visit.scheduledEnd)}
      </span>
      <a href={`/app/chamados/${visit.ticket.id}`} className="text-primary hover:underline">
        #{visit.ticket.number}
      </a>
      <span className="text-muted-foreground">{visit.ticket.client?.name}</span>
      <Badge tone={statusTone(visit.status)}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
      {visit.status === 'SCHEDULED' && (
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              const novaData = prompt('Novo horário de início (YYYY-MM-DDTHH:mm)?', visit.scheduledStart.slice(0, 16));
              if (!novaData) return;
              reschedule.mutate(
                { scheduledStart: new Date(novaData).toISOString() },
                { onSuccess: () => toast.success('Visita reagendada.'), onError: onErr },
              );
            }}
          >
            Reagendar
          </button>
          <button
            type="button"
            className="text-red-600 hover:underline"
            onClick={() =>
              cancel.mutate(undefined, { onSuccess: () => toast.success('Visita cancelada.'), onError: onErr })
            }
          >
            Cancelar
          </button>
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/app/agenda
git commit -m "feat(frontend): página /app/agenda"
```

---

## Task 12: Frontend — bloco "Visitas" no chamado + labels na timeline

**Files:**
- Modify: `frontend/src/app/app/chamados/[id]/page.tsx`
- Modify: `frontend/src/components/ticket-timeline.tsx`

**Interfaces:**
- Consumes: `useVisits` (Task 10).

- [ ] **Step 1: Labels dos eventos novos em `ticket-timeline.tsx`**

Em `eventText`, adicionar antes do `default`:

```ts
    case 'VISIT_SCHEDULED':
      return 'Visita agendada';
    case 'VISIT_STARTED':
      return 'Visita iniciada (check-in)';
    case 'VISIT_COMPLETED':
      return 'Visita concluída';
    case 'VISIT_CANCELLED':
      return 'Visita cancelada';
```

- [ ] **Step 2: Bloco "Visitas" em `[id]/page.tsx`**

Adicionar o import `import { VISIT_STATUS_LABELS, useVisits } from '@/lib/visits';` e o componente:

```tsx
function VisitsBlock({ ticketId }: { ticketId: string }) {
  const { data: visits } = useVisits({ ticketId });
  if (!visits || visits.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Visitas</h2>
      <ul className="flex flex-col gap-1">
        {visits.map((v) => (
          <li key={v.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span>{new Date(v.scheduledStart).toLocaleString('pt-BR')}</span>
            <span className="text-muted-foreground">{v.technician.name}</span>
            <span className="ml-auto text-xs text-muted-foreground">{VISIT_STATUS_LABELS[v.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

E inserir `<VisitsBlock ticketId={id} />` no JSX, logo antes da seção "Movimentações".

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ticket-timeline.tsx frontend/src/app/app/chamados/[id]/page.tsx
git commit -m "feat(frontend): bloco de visitas no chamado e labels de evento"
```

---

## Task 13: Frontend — `/app/campo` (lista do dia)

**Files:**
- Create: `frontend/src/app/app/campo/page.tsx`

**Interfaces:**
- Consumes: `useVisits({ technicianId: 'me', date })`, `useSession`.

- [ ] **Step 1: `page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { VISIT_STATUS_LABELS, useVisits, type Visit } from '@/lib/visits';

function statusTone(s: Visit['status']) {
  return s === 'DONE' ? 'green' : s === 'IN_PROGRESS' ? 'amber' : s === 'CANCELLED' ? 'neutral' : 'blue';
}

export default function CampoPage() {
  const [date] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: visits, isLoading } = useVisits({ technicianId: 'me', date });

  return (
    <div className="flex flex-col gap-3 p-3">
      <h1 className="text-lg font-semibold">Minhas visitas de hoje</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && (visits?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma visita hoje.</p>
      )}
      <ul className="flex flex-col gap-2">
        {visits?.map((v) => (
          <li key={v.id}>
            <Link
              href={`/app/campo/${v.id}`}
              className="flex flex-col gap-1 rounded-lg border border-border p-3 active:bg-accent"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">
                  {new Date(v.scheduledStart).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Badge tone={statusTone(v.status)}>{VISIT_STATUS_LABELS[v.status]}</Badge>
              </div>
              <span className="text-sm font-medium">#{v.ticket.number} — {v.ticket.title}</span>
              <span className="text-xs text-muted-foreground">
                {v.ticket.client?.name} {v.ticket.location?.name ? `· ${v.ticket.location.name}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/app/campo/page.tsx
git commit -m "feat(frontend): lista de visitas do dia (/app/campo)"
```

---

## Task 14: Frontend — `/app/campo/[visitId]` (execução da visita)

**Files:**
- Create: `frontend/src/app/app/campo/[visitId]/page.tsx`
- Create: `frontend/src/components/signature-pad.tsx`

**Interfaces:**
- Consumes: `useVisit`, `useCheckIn`, `useCheckOut`, `useSetChecklist`, `useSetLabor`, `useCloseVisit`, `useUploadVisitAttachment` (Task 10).
- Produces: `<SignaturePad onCapture={(file: File) => void} />` — canvas de assinatura, sem lib nova.

- [ ] **Step 1: `signature-pad.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/** Canvas de assinatura: desenha com o dedo/mouse, exporta como PNG (`File`). Sem lib nova. */
export function SignaturePad({ onCapture }: { onCapture: (file: File) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  }

  function capture() {
    canvasRef.current!.toBlob((blob) => {
      if (blob) onCapture(new File([blob], 'assinatura.png', { type: 'image/png' }));
    }, 'image/png');
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={320}
        height={160}
        className="touch-none rounded-md border border-input bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="h-9" onClick={clear}>
          Limpar
        </Button>
        <Button type="button" className="h-9" disabled={!hasDrawn} onClick={capture}>
          Confirmar assinatura
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import {
  useCheckIn,
  useCheckOut,
  useCloseVisit,
  useSetChecklist,
  useUploadVisitAttachment,
  useVisit,
} from '@/lib/visits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from '@/components/signature-pad';

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

function geolocate(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({}),
      { timeout: 5000 },
    );
  });
}

export default function VisitExecutionPage({ params }: { params: { visitId: string } }) {
  const { visitId } = params;
  const router = useRouter();
  const { data: visit, isLoading } = useVisit(visitId);
  const checkIn = useCheckIn(visitId);
  const checkOut = useCheckOut(visitId);
  const setChecklist = useSetChecklist(visitId);
  const close = useCloseVisit(visitId);
  const upload = useUploadVisitAttachment(visitId);
  const [answers, setAnswers] = useState<Record<string, { done: boolean; note: string }>>({});

  if (isLoading || !visit) return <p className="p-3 text-sm text-muted-foreground">Carregando…</p>;

  const hasSignature = visit.attachments.some((a) => a.kind === 'SIGNATURE');
  const items = visit.checklistTemplate?.items ?? [];
  const answered = (itemId: string) =>
    answers[itemId] ?? visit.checklistAnswers.find((a) => a.itemId === itemId) ?? { done: false, note: '' };
  const allAnswered = items.length > 0 && items.every((i) => answered(i.id).done !== undefined && (answers[i.id] || visit.checklistAnswers.some((a) => a.itemId === i.id)));

  async function doCheckIn() {
    const geo = await geolocate();
    checkIn.mutate(geo, { onSuccess: () => toast.success('Check-in feito.'), onError: onErr });
  }

  async function doCheckOut() {
    const geo = await geolocate();
    checkOut.mutate(geo, { onSuccess: () => toast.success('Check-out feito.'), onError: onErr });
  }

  function saveChecklist() {
    setChecklist.mutate(
      { answers: items.map((i) => ({ itemId: i.id, done: answered(i.id).done, note: answered(i.id).note || undefined })) },
      { onSuccess: () => toast.success('Checklist salvo.'), onError: onErr },
    );
  }

  function doClose() {
    close.mutate(undefined, {
      onSuccess: () => {
        toast.success('Visita fechada — laudo enviado ao cliente.');
        router.push('/app/campo');
      },
      onError: onErr,
    });
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <p className="text-xs text-muted-foreground">#{visit.ticket.number}</p>
        <h1 className="text-lg font-semibold">{visit.ticket.title}</h1>
        <p className="text-sm text-muted-foreground">
          {visit.ticket.client?.name} {visit.ticket.location?.name ? `· ${visit.ticket.location.name}` : ''}
        </p>
      </div>

      {visit.status === 'SCHEDULED' && (
        <Button className="h-11" disabled={checkIn.isPending} onClick={doCheckIn}>
          Check-in
        </Button>
      )}

      {visit.status !== 'SCHEDULED' && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Checklist</h2>
            {items.map((item) => {
              const a = answered(item.id);
              return (
                <div key={item.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={a.done}
                      onChange={(e) =>
                        setAnswers((prev) => ({ ...prev, [item.id]: { done: e.target.checked, note: a.note } }))
                      }
                    />
                    {item.label}
                  </label>
                  <Input
                    placeholder="Observação (opcional)"
                    className="h-8 text-xs"
                    defaultValue={a.note}
                    onBlur={(e) =>
                      setAnswers((prev) => ({ ...prev, [item.id]: { done: a.done, note: e.target.value } }))
                    }
                  />
                </div>
              );
            })}
            <Button variant="outline" className="h-9" disabled={setChecklist.isPending} onClick={saveChecklist}>
              Salvar checklist
            </Button>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Fotos</h2>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate({ file, kind: 'PHOTO_AFTER' }, { onError: onErr });
              }}
            />
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {visit.attachments.filter((a) => a.kind === 'PHOTO_BEFORE' || a.kind === 'PHOTO_AFTER').map((a) => (
                <span key={a.id}>📷 {a.filename}</span>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Assinatura do cliente</h2>
            {hasSignature ? (
              <p className="text-sm text-green-700">Assinatura registrada.</p>
            ) : (
              <SignaturePad
                onCapture={(file) => upload.mutate({ file, kind: 'SIGNATURE' }, { onError: onErr })}
              />
            )}
          </section>

          {visit.status === 'IN_PROGRESS' && !visit.checkOutAt && (
            <Button className="h-11" disabled={checkOut.isPending} onClick={doCheckOut}>
              Check-out
            </Button>
          )}

          {visit.status === 'IN_PROGRESS' && visit.checkOutAt && (
            <Button className="h-11" disabled={close.isPending || !allAnswered || !hasSignature} onClick={doClose}>
              Fechar visita
            </Button>
          )}

          {visit.status === 'DONE' && (
            <p className="text-sm text-green-700">
              Visita concluída{visit.reportSentAt ? ' — laudo enviado.' : '.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/app/campo frontend/src/components/signature-pad.tsx
git commit -m "feat(frontend): execução da visita em campo (check-in, checklist, assinatura, check-out, fechar)"
```

---

## Task 15: Frontend — aba "Checklists" em `/app/config`

**Files:**
- Modify: `frontend/src/app/app/config/page.tsx`

**Interfaces:**
- Consumes: `/checklist-templates` (Task 2).

- [ ] **Step 1: Componente `ChecklistTemplatesTab`**

Adicionar em `config/page.tsx` (mesmo molde de `AssetTypesTab`, com a lista de itens embutida):

```tsx
interface ChecklistTemplateItemRow {
  id: string;
  label: string;
  order: number;
}
interface ChecklistTemplateRow {
  id: string;
  categoryId: string | null;
  name: string;
  active: boolean;
  items: ChecklistTemplateItemRow[];
}

function ChecklistTemplatesTab() {
  const qc = useQueryClient();
  const [newItemLabel, setNewItemLabel] = useState<Record<string, string>>({});
  const invalidate = () => qc.invalidateQueries({ queryKey: ['checklist-templates'] });

  const { data } = useQuery({
    queryKey: ['checklist-templates'],
    queryFn: () => api<ChecklistTemplateRow[]>('/checklist-templates'),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Category[]>('/categories'),
  });
  const addItem = useMutation({
    mutationFn: (v: { template: ChecklistTemplateRow; label: string }) =>
      api(`/checklist-templates/${v.template.id}`, {
        method: 'PATCH',
        body: { items: [...v.template.items.map((i) => ({ id: i.id, label: i.label, order: i.order })), { label: v.label }] },
      }),
    onSuccess: () => {
      invalidate();
      toast.success('Item adicionado.');
    },
    onError: errToast,
  });
  const toggleActive = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      api(`/checklist-templates/${v.id}`, { method: 'PATCH', body: { active: v.active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Checklist atualizado.');
    },
    onError: errToast,
  });

  const categoryName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? 'Padrão (sem categoria)';

  return (
    <div className="flex max-w-2xl flex-col gap-4 pt-4">
      {data?.map((t) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t.name}</span>
            <Badge tone="neutral">{categoryName(t.categoryId)}</Badge>
            <button
              type="button"
              className="ml-auto text-sm text-primary hover:underline"
              onClick={() => toggleActive.mutate({ id: t.id, active: !t.active })}
            >
              {t.active ? 'Desativar' : 'Ativar'}
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {t.items.map((i) => (
              <li key={i.id} className="text-sm text-muted-foreground">
                • {i.label}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const label = (newItemLabel[t.id] ?? '').trim();
              if (label) {
                addItem.mutate({ template: t, label });
                setNewItemLabel((prev) => ({ ...prev, [t.id]: '' }));
              }
            }}
          >
            <Input
              placeholder="Novo item"
              className="h-8 text-sm"
              value={newItemLabel[t.id] ?? ''}
              onChange={(e) => setNewItemLabel((prev) => ({ ...prev, [t.id]: e.target.value }))}
            />
            <Button type="submit" className="h-8">
              Adicionar item
            </Button>
          </form>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Registrar a aba**

No array `tabs` (perto de `{ value: 'tipos-ativo', label: 'Tipos de ativo' }`), adicionar:

```ts
    { value: 'checklists', label: 'Checklists' },
```

E na renderização condicional das abas:

```tsx
      {tab === 'checklists' && isAdmin && <ChecklistTemplatesTab />}
```

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/app/config/page.tsx
git commit -m "feat(frontend): aba Checklists em Configurações"
```

---

## Task 16: Frontend — navegação (Agenda/Campo) e criação de checklist por categoria

**Files:**
- Modify: `frontend/src/components/nav.tsx`
- Modify: `frontend/src/app/app/config/page.tsx` (form de criação de checklist por categoria, complementando a Task 15)

**Interfaces:**
- Consumes: `useSession` (`@/lib/auth`) pra decidir os links por papel.

- [ ] **Step 1: Links condicionais por papel em `nav.tsx`**

Trocar `APP_LINKS` (const fixa) por uma função que recebe o papel:

```tsx
function appLinks(role: string | undefined) {
  const links = [
    { href: '/app', label: 'Fila' },
    { href: '/app/agenda', label: 'Agenda' },
  ];
  if (role === 'AGENT') links.push({ href: '/app/campo', label: 'Campo' });
  links.push(
    { href: '/app/clientes', label: 'Clientes' },
    { href: '/app/ativos', label: 'Ativos' },
    { href: '/app/config', label: 'Configurações' },
  );
  return links;
}
```

E em `AppNav`, trocar `APP_LINKS.map(...)` por:

```tsx
  const { logout, user } = useSession();
  ...
  {appLinks(user?.role).map((l) => (
```

(`useSession` já expõe `user`; ajustar a desestruturação existente.)

- [ ] **Step 2: Form de criação de checklist por categoria**

Em `ChecklistTemplatesTab` (Task 15), adicionar acima da lista:

```tsx
  const [form, setForm] = useState({ categoryId: '', name: '' });
  const create = useMutation({
    mutationFn: () =>
      api('/checklist-templates', {
        method: 'POST',
        body: { categoryId: form.categoryId || undefined, name: form.name, items: [{ label: 'Item 1' }] },
      }),
    onSuccess: () => {
      invalidate();
      setForm({ categoryId: '', name: '' });
      toast.success('Checklist criado.');
    },
    onError: errToast,
  });
```

E o form no JSX (antes do `.map`):

```tsx
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (form.name.trim()) create.mutate();
        }}
      >
        <Select
          className="h-9 w-48"
          value={form.categoryId}
          onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
        >
          <option value="">Sem categoria (padrão)</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input
          placeholder="Nome do checklist"
          className="h-9 w-56"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Button type="submit" className="h-9" disabled={create.isPending}>
          Novo checklist
        </Button>
      </form>
```

- [ ] **Step 3: Build de sanidade**

Run: `npm run build` (em `frontend/`)
Expected: compila sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/nav.tsx frontend/src/app/app/config/page.tsx
git commit -m "feat(frontend): nav de Agenda/Campo e criação de checklist por categoria"
```

---

## Task 17: E2E Playwright — agendar e executar uma visita

**Files:**
- Modify: `frontend/e2e/seed-e2e.ts` (adiciona um técnico AGENT)
- Create: `frontend/e2e/agenda-campo-visita.spec.ts`

**Interfaces:**
- Consumes: `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_AGENT_EMAIL`, `E2E_AGENT_PASSWORD` (novo).

- [ ] **Step 1: Seed do técnico AGENT**

Em `seed-e2e.ts`, adicionar as constantes e o upsert:

```ts
export const E2E_AGENT_EMAIL = 'agente@e2e.test';
export const E2E_AGENT_PASSWORD = 'e2e12345';
```

No `cleanup`, incluir o e-mail do agente na lista de `user.deleteMany`:

```ts
  await prisma.user.deleteMany({ where: { email: { in: [E2E_EMAIL, E2E_ADMIN_EMAIL, E2E_AGENT_EMAIL] } } });
```

Depois do upsert do admin, adicionar:

```ts
  const agentHash = await bcrypt.hash(E2E_AGENT_PASSWORD, 10);
  await prisma.user.upsert({
    where: { email: E2E_AGENT_EMAIL },
    update: { passwordHash: agentHash, active: true, role: 'AGENT', type: 'INTERNAL', clientId: null },
    create: {
      name: 'Agente E2E',
      email: E2E_AGENT_EMAIL,
      passwordHash: agentHash,
      type: 'INTERNAL',
      role: 'AGENT',
      active: true,
    },
  });
```

- [ ] **Step 2: `agenda-campo-visita.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_AGENT_EMAIL,
  E2E_AGENT_PASSWORD,
} from './seed-e2e';

async function login(page: Page, email: string, password: string) {
  await page.goto('/app/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('agenda uma visita e o técnico executa até fechar', async ({ page }) => {
  test.setTimeout(120_000);
  const titulo = `Chamado visita E2E ${Date.now()}`;

  // 1. ADMIN abre um chamado e agenda uma visita pro Agente E2E, hoje.
  await login(page, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD);
  await page.goto('/app/chamados/novo');
  await page.locator('select').nth(0).selectOption({ label: 'Cliente E2E' });
  await page.locator('select').nth(1).selectOption({ index: 1 });
  await page.locator('#title').fill(titulo);
  await page.locator('#desc').fill('Chamado gerado pelo smoke E2E de visita.');
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/(?!novo)[^/]+$/);

  await page.goto('/app/agenda');
  await page.getByRole('button', { name: 'Agendar visita' }).click();
  await page.locator('select').first().selectOption({ label: new RegExp(titulo) });
  await page.locator('select').nth(1).selectOption({ label: 'Agente E2E' });
  const hoje = new Date().toISOString().slice(0, 10);
  await page.locator('input[type="date"]').first().fill(hoje);
  await page.getByRole('button', { name: 'Agendar visita' }).click();
  await expect(page.getByText(titulo, { exact: false })).toBeVisible();

  // 2. Agente loga, vai em Campo, faz check-in, checklist, assinatura, check-out e fecha.
  await login(page, E2E_AGENT_EMAIL, E2E_AGENT_PASSWORD);
  await page.goto('/app/campo');
  await page.getByText(titulo, { exact: false }).click();
  await page.getByRole('button', { name: 'Check-in' }).click();
  await expect(page.getByRole('button', { name: 'Check-in' })).toHaveCount(0);

  for (const checkbox of await page.getByRole('checkbox').all()) {
    await checkbox.check();
  }
  await page.getByRole('button', { name: 'Salvar checklist' }).click();

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 80);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Confirmar assinatura' }).click();
  await expect(page.getByText('Assinatura registrada.')).toBeVisible();

  await page.getByRole('button', { name: 'Check-out' }).click();
  await page.getByRole('button', { name: 'Fechar visita' }).click();
  await page.waitForURL('**/app/campo');
});
```

- [ ] **Step 3: Rodar**

Run: `npm run test:e2e` (em `frontend/`, definido no `package.json` — confirmar o nome exato do script antes de rodar; se não existir, usar `npx playwright test`)
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/e2e/seed-e2e.ts frontend/e2e/agenda-campo-visita.spec.ts
git commit -m "test(e2e): smoke de agendar e executar uma visita de campo"
```

---

## Task 18: CHANGELOG e versão 0.4.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Interfaces:** nenhuma (só metadados de release).

- [ ] **Step 1: `CHANGELOG.md`**

Substituir a seção `## [Não lançado]` por:

```markdown
## [Não lançado]

## [0.4.0] - <DATA_DO_RELEASE>

### Adicionado
- **Visitas técnicas** vinculadas ao chamado: agendamento (técnico + janela de
  data/hora), reagendamento e cancelamento.
- **Agenda** por técnico e dia (`/app/agenda`).
- **Execução em campo** (`/app/campo`, mobile): check-in/check-out com
  geolocalização opcional, checklist configurável por categoria com fotos,
  assinatura do cliente em canvas, apontamento de horas (derivado do
  check-in/out, editável).
- **Laudo de atendimento em PDF**, gerado e enviado por e-mail ao cliente
  automaticamente ao fechar a visita (link pro chamado no portal).
- Cadastro de **Checklists** por categoria em Configurações.

### Alterado
- Chamado `OPEN` vira `IN_PROGRESS` automaticamente no check-in da primeira
  visita.
```

Ajustar `<DATA_DO_RELEASE>` pra data real do commit de release.

- [ ] **Step 2: Bump de versão**

Em `backend/package.json` e `frontend/package.json`, trocar `"version": "0.3.0"` por `"version": "0.4.0"`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md backend/package.json frontend/package.json
git commit -m "chore: release 0.4.0 — agenda e execução em campo"
git tag v0.4.0
```

---

## Notas de execução

- **Deploy** (bump de `deploy/build-and-push.sh`, `deploy/stack.env.example`, `portainer-stack.env`, build+push das imagens Docker Hub) fica de fora deste plano — mesma decisão travada em [[deploy-pergunta-antes]]: perguntar ao usuário no fim antes de rodar.
- **Push→pull**: depois do release, `git push` no `os-exec` e sincronizar `Z:/Projetos/OS` (pull --ff-only), conforme [[push-implica-pull-z]].
