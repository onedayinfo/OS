# Base de conhecimento (Fase 0.7.0 — parte 4/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CRUD de artigos de conhecimento (procedimentos/manuais), vinculados
opcionalmente a categoria e/ou tipo de ativo, com busca dedicada e sugestão
automática na ficha do chamado.

**Architecture:** Model novo `KnowledgeArticle` (título + corpo texto +
vínculos opcionais); `Attachment` ganha `articleId` opcional (reaproveita o
model polimórfico existente, sem tabela nova de anexo); módulo backend
`knowledge` isolado; extensão pontual de `AttachmentsService`/
`AttachmentsController` pros anexos de artigo; frontend com tela de busca,
criação, detalhe/edição, e um bloco de sugestões na ficha do chamado.

**Tech Stack:** NestJS + Prisma 6 + PostgreSQL (backend); Next.js 14 + React
Query (frontend); Vitest (unit/integração); Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-09-22-base-conhecimento-design.md`

## Global Constraints

- `body` é texto simples (`String`), sem markdown/editor rico — mesmo
  padrão de `Ticket.description`.
- Vínculo a `categoryId`/`assetTypeId` é opcional e independente — um
  artigo pode ter os dois, um, ou nenhum.
- Só `ADMIN`/`AGENT` acessam qualquer rota de `knowledge-articles` — sem
  exposição no portal do cliente nesta fase.
- Busca simples (`contains`, `mode: 'insensitive'`) em `title`/`body` — sem
  full-text search.
- Anexos reaproveitam 100% o `Attachment`/`AttachmentsService` existentes —
  `articleId` é só mais um campo opcional na mesma tabela polimórfica,
  mesmo padrão de `assetId`/`visitId`.
- `GET /knowledge-articles/suggestions` precisa ser declarada **antes** de
  `GET /knowledge-articles/:id` no controller (ordem de rota importa no
  NestJS).
- Sem `DELETE` — só `active: false` via `PATCH` (mesmo padrão do resto do
  sistema: nada tem hard-delete hoje).
- Sem bump de versão nesta task — esta é a última parte da 0.7.0; o
  release da fase inteira acontece depois, como uma etapa separada,
  combinada com o usuário.

---

### Task 1: Migração — `KnowledgeArticle` + `Attachment.articleId`

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: model `KnowledgeArticle { id, title, body, categoryId?,
  assetTypeId?, active, createdById, createdAt, updatedAt }`;
  `Attachment.articleId: String?`; relações reversas
  `Category.knowledgeArticles`, `AssetType.knowledgeArticles`,
  `User.knowledgeArticles`.

- [ ] **Step 1: Editar o schema**

No model `Category` (por volta da linha 160-173), adicionar a relação
reversa junto das outras (`tickets`, `checklistTemplate`, `contracts`,
`quotes`):

```prisma
  knowledgeArticles KnowledgeArticle[]
```

No model `AssetType` (por volta da linha 477-487), adicionar:

```prisma
  knowledgeArticles KnowledgeArticle[]
```

No model `User` (por volta da linha 113-138), adicionar junto das outras
relações (`visits`, etc.):

```prisma
  knowledgeArticles KnowledgeArticle[]
```

Logo após o model `ChecklistTemplateItem` (por volta da linha 202) ou em
qualquer ponto conveniente do arquivo perto de `Category`/`AssetType`,
adicionar o model novo:

```prisma
model KnowledgeArticle {
  id          String   @id @default(cuid())
  title       String
  body        String
  categoryId  String?
  assetTypeId String?
  active      Boolean  @default(true)
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  category    Category?    @relation(fields: [categoryId], references: [id])
  assetType   AssetType?   @relation(fields: [assetTypeId], references: [id])
  createdBy   User         @relation(fields: [createdById], references: [id])
  attachments Attachment[]

  @@index([categoryId])
  @@index([assetTypeId])
  @@map("knowledge_articles")
}
```

No model `Attachment` (por volta da linha 629-654), adicionar o campo e a
relação junto dos outros vínculos opcionais (`ticketId`, `commentId`,
`assetId`, `visitId`):

```prisma
model Attachment {
  id           String         @id @default(cuid())
  ticketId     String?
  commentId    String?
  assetId      String?
  visitId      String?
  articleId    String?
  kind         AttachmentKind @default(GENERIC)
  filename     String
  storedPath   String
  mime         String
  size         Int
  uploadedById String
  createdAt    DateTime       @default(now())

  ticket     Ticket?           @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  comment    TicketComment?    @relation(fields: [commentId], references: [id], onDelete: Cascade)
  asset      Asset?            @relation(fields: [assetId], references: [id], onDelete: Cascade)
  visit      Visit?            @relation(fields: [visitId], references: [id], onDelete: Cascade)
  article    KnowledgeArticle? @relation(fields: [articleId], references: [id], onDelete: Cascade)
  uploadedBy User              @relation(fields: [uploadedById], references: [id])

  @@index([ticketId])
  @@index([commentId])
  @@index([assetId])
  @@index([visitId])
  @@index([articleId])
  @@map("attachments")
}
```

- [ ] **Step 2: Gerar e aplicar a migração**

```bash
cd backend && npx prisma migrate dev --name knowledge_articles
```

- [ ] **Step 3: Validar**

```bash
cd backend && npx prisma validate
```

Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(knowledge): schema da base de conhecimento"
```

---

### Task 2: `KnowledgeService` — CRUD (`findAll`/`create`/`findOne`/`update`)

**Files:**
- Create: `backend/src/knowledge/dto/create-article.dto.ts`
- Create: `backend/src/knowledge/dto/update-article.dto.ts`
- Create: `backend/src/knowledge/knowledge.service.ts`
- Create: `backend/src/knowledge/knowledge.service.spec.ts`

**Interfaces:**
- Consumes: `PrismaService` (global, sem import de módulo necessário —
  mesmo padrão de `CategoriesService`).
- Produces: `KnowledgeService.findAll(filter)`, `.create(dto, actor)`,
  `.findOne(id)`, `.update(id, dto)` — consumidos pelo controller (Task 4).

- [ ] **Step 1: Criar os DTOs**

Criar `backend/src/knowledge/dto/create-article.dto.ts`:

```ts
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateArticleDto {
  @IsString() @MinLength(1) title!: string;
  @IsString() @MinLength(1) body!: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() assetTypeId?: string;
}
```

Criar `backend/src/knowledge/dto/update-article.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateArticleDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() @MinLength(1) body?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() assetTypeId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `backend/src/knowledge/knowledge.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service.js';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeArticle: {
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ id: 'a1', title: 'X', body: 'Y' }),
      update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'a1', ...data })),
    },
    ...overrides,
  };
}

const actor = { id: 'u1', type: 'INTERNAL', role: 'AGENT', clientId: null };

describe('KnowledgeService.findAll', () => {
  it('sem filtro nenhum → where vazio', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({});
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('com q → OR em title/body case-insensitive', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({ q: 'rede' });
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({
      OR: [
        { title: { contains: 'rede', mode: 'insensitive' } },
        { body: { contains: 'rede', mode: 'insensitive' } },
      ],
    });
  });

  it('com categoryId e assetTypeId → ambos no where', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.findAll({ categoryId: 'c1', assetTypeId: 't1' });
    expect(prisma.knowledgeArticle.findMany.mock.calls[0][0].where).toEqual({
      categoryId: 'c1',
      assetTypeId: 't1',
    });
  });
});

describe('KnowledgeService.create', () => {
  it('grava createdById a partir do actor', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.create({ title: 'T', body: 'B' }, actor);
    expect(prisma.knowledgeArticle.create).toHaveBeenCalledWith({
      data: { title: 'T', body: 'B', categoryId: null, assetTypeId: null, createdById: 'u1' },
    });
  });
});

describe('KnowledgeService.findOne', () => {
  it('artigo inexistente → NotFoundException', async () => {
    const prisma = makePrisma({ knowledgeArticle: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new KnowledgeService(prisma as any);
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('KnowledgeService.update', () => {
  it('artigo inexistente → NotFoundException', async () => {
    const prisma = makePrisma({
      knowledgeArticle: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const service = new KnowledgeService(prisma as any);
    await expect(service.update('nope', { title: 'X' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('atualiza só os campos enviados', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.update('a1', { active: false });
    expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { active: false },
    });
  });

  it('categoryId vazio ("") limpa o vínculo', async () => {
    const prisma = makePrisma();
    const service = new KnowledgeService(prisma as any);
    await service.update('a1', { categoryId: '' });
    expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: { categoryId: null },
    });
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
cd backend && npx vitest run src/knowledge/knowledge.service.spec.ts
```

Expected: FAIL — `KnowledgeService` ainda não existe.

- [ ] **Step 4: Implementar**

Criar `backend/src/knowledge/knowledge.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filter: { q?: string; categoryId?: string; assetTypeId?: string }) {
    const where: Prisma.KnowledgeArticleWhereInput = {};
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.assetTypeId) where.assetTypeId = filter.assetTypeId;
    if (filter.q) {
      where.OR = [
        { title: { contains: filter.q, mode: 'insensitive' } },
        { body: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.knowledgeArticle.findMany({
      where,
      include: { category: true, assetType: true },
      orderBy: { title: 'asc' },
    });
  }

  create(dto: CreateArticleDto, actor: Actor) {
    return this.prisma.knowledgeArticle.create({
      data: {
        title: dto.title,
        body: dto.body,
        categoryId: dto.categoryId ?? null,
        assetTypeId: dto.assetTypeId ?? null,
        createdById: actor.id,
      },
    });
  }

  async findOne(id: string) {
    const article = await this.prisma.knowledgeArticle.findUnique({
      where: { id },
      include: { category: true, assetType: true, attachments: true },
    });
    if (!article) throw new NotFoundException('Artigo não encontrado.');
    return article;
  }

  async update(id: string, dto: UpdateArticleDto) {
    const found = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Artigo não encontrado.');
    const data: Prisma.KnowledgeArticleUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.assetTypeId !== undefined) {
      data.assetType = dto.assetTypeId
        ? { connect: { id: dto.assetTypeId } }
        : { disconnect: true };
    }
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.knowledgeArticle.update({ where: { id }, data });
  }
}
```

> Nota: o teste do Step 2 espera `data: { categoryId: null }` (forma
> "unchecked", igual ao resto do `update` de `Category`/`Contract` no
> projeto) e não `data: { category: { disconnect: true } }` — use a forma
> unchecked abaixo pra bater com o teste e com o padrão já usado em
> `CategoriesService.update`/`ContractsService.update` (que escrevem
> direto no campo escalar `xId`, não via relação nested):

```ts
  async update(id: string, dto: UpdateArticleDto) {
    const found = await this.prisma.knowledgeArticle.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Artigo não encontrado.');
    const data: Prisma.KnowledgeArticleUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = dto.body;
    if (dto.categoryId !== undefined) data.categoryId = dto.categoryId || null;
    if (dto.assetTypeId !== undefined) data.assetTypeId = dto.assetTypeId || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.knowledgeArticle.update({ where: { id }, data });
  }
```

Use esta segunda versão de `update` (a `UncheckedUpdateInput`) na
implementação final — é a que bate com os testes do Step 2.

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd backend && npx vitest run src/knowledge/knowledge.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/knowledge
git commit -m "feat(knowledge): CRUD de artigos (KnowledgeService)"
```

---

### Task 3: `KnowledgeService.suggestFor` — sugestão por categoria/tipo de ativo

**Files:**
- Modify: `backend/src/knowledge/knowledge.service.ts`
- Modify: `backend/src/knowledge/knowledge.service.spec.ts`

**Interfaces:**
- Produces: `KnowledgeService.suggestFor(ticketId: string): Promise<KnowledgeArticle[]>`
  — consumido pelo controller (Task 4).

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `backend/src/knowledge/knowledge.service.spec.ts`:

```ts
describe('KnowledgeService.suggestFor', () => {
  function makeTicketPrisma(ticket: any, articles: any[] = []) {
    return makePrisma({
      ticket: { findUnique: vi.fn().mockResolvedValue(ticket) },
      knowledgeArticle: {
        ...makePrisma().knowledgeArticle,
        findMany: vi.fn().mockResolvedValue(articles),
      },
    });
  }

  it('chamado inexistente → NotFoundException', async () => {
    const prisma = makeTicketPrisma(null);
    const service = new KnowledgeService(prisma as any);
    await expect(service.suggestFor('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chamado sem categoria e sem ativos → devolve [] sem consultar o banco de artigos', async () => {
    const prisma = makeTicketPrisma({ categoryId: null, assets: [] });
    const service = new KnowledgeService(prisma as any);
    const result = await service.suggestFor('t1');
    expect(result).toEqual([]);
    expect(prisma.knowledgeArticle.findMany).not.toHaveBeenCalled();
  });

  it('bate por categoria', async () => {
    const prisma = makeTicketPrisma({ categoryId: 'c1', assets: [] }, [{ id: 'a1' }]);
    const service = new KnowledgeService(prisma as any);
    const result = await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ categoryId: 'c1' }] },
      orderBy: { title: 'asc' },
    });
    expect(result).toEqual([{ id: 'a1' }]);
  });

  it('bate por tipo de ativo (dedup de tipos repetidos entre ativos)', async () => {
    const prisma = makeTicketPrisma(
      { categoryId: null, assets: [{ typeId: 't1' }, { typeId: 't1' }, { typeId: 't2' }] },
      [{ id: 'a1' }],
    );
    const service = new KnowledgeService(prisma as any);
    await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ assetTypeId: { in: ['t1', 't2'] } }] },
      orderBy: { title: 'asc' },
    });
  });

  it('bate pelos dois (categoria e tipo de ativo) → OR com as duas condições', async () => {
    const prisma = makeTicketPrisma({ categoryId: 'c1', assets: [{ typeId: 't1' }] });
    const service = new KnowledgeService(prisma as any);
    await service.suggestFor('t1');
    expect(prisma.knowledgeArticle.findMany).toHaveBeenCalledWith({
      where: { active: true, OR: [{ categoryId: 'c1' }, { assetTypeId: { in: ['t1'] } }] },
      orderBy: { title: 'asc' },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && npx vitest run src/knowledge/knowledge.service.spec.ts
```

Expected: FAIL nos 5 testes novos — `suggestFor` ainda não existe.

- [ ] **Step 3: Implementar**

Em `backend/src/knowledge/knowledge.service.ts`, adicionar (import de
`NotFoundException` já existe no topo do arquivo):

```ts
  async suggestFor(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { categoryId: true, assets: { select: { typeId: true } } },
    });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    const assetTypeIds = [...new Set(ticket.assets.map((a) => a.typeId))];
    const or: Prisma.KnowledgeArticleWhereInput[] = [];
    if (ticket.categoryId) or.push({ categoryId: ticket.categoryId });
    if (assetTypeIds.length) or.push({ assetTypeId: { in: assetTypeIds } });
    if (or.length === 0) return [];

    return this.prisma.knowledgeArticle.findMany({
      where: { active: true, OR: or },
      orderBy: { title: 'asc' },
    });
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
cd backend && npx vitest run src/knowledge/knowledge.service.spec.ts
```

Expected: PASS (todos os describes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add backend/src/knowledge
git commit -m "feat(knowledge): sugestao de artigos por categoria/tipo de ativo do chamado"
```

---

### Task 4: `knowledge.controller`/`knowledge.module` + registro no `app.module.ts`

**Files:**
- Create: `backend/src/knowledge/knowledge.controller.ts`
- Create: `backend/src/knowledge/knowledge.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Tasks 2-3).
- Produces: rotas HTTP `GET/POST /knowledge-articles`,
  `GET /knowledge-articles/suggestions`, `GET/PATCH /knowledge-articles/:id`.

- [ ] **Step 1: Criar o controller**

Criar `backend/src/knowledge/knowledge.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { KnowledgeService } from './knowledge.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';

@Controller('knowledge-articles')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @Roles('ADMIN', 'AGENT')
  findAll(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('assetTypeId') assetTypeId?: string,
  ) {
    return this.knowledge.findAll({ q, categoryId, assetTypeId });
  }

  @Post()
  @Roles('ADMIN', 'AGENT')
  create(@Body() dto: CreateArticleDto, @CurrentUser() actor: CurrentUserData) {
    return this.knowledge.create(dto, actor);
  }

  // Precisa vir ANTES de `:id` — senão "suggestions" seria lido como um id.
  @Get('suggestions')
  @Roles('ADMIN', 'AGENT')
  suggestions(@Query('ticketId') ticketId: string) {
    return this.knowledge.suggestFor(ticketId);
  }

  @Get(':id')
  @Roles('ADMIN', 'AGENT')
  findOne(@Param('id') id: string) {
    return this.knowledge.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'AGENT')
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledge.update(id, dto);
  }
}
```

- [ ] **Step 2: Criar o módulo**

Criar `backend/src/knowledge/knowledge.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service.js';
import { KnowledgeController } from './knowledge.controller.js';

@Module({
  providers: [KnowledgeService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
```

- [ ] **Step 3: Registrar no `app.module.ts`**

Em `backend/src/app.module.ts`, adicionar o import junto dos outros (por
volta da linha 34, depois de `DashboardModule`):

```ts
import { KnowledgeModule } from './knowledge/knowledge.module.js';
```

E adicionar `KnowledgeModule` na lista de `imports` do `@Module` (por volta
da linha 68, depois de `DashboardModule`).

- [ ] **Step 4: Validar o boot real**

```bash
cd backend && npm run start:dev
```

Espera "Nest application successfully started" sem erro de "can't resolve
dependencies". Interrompa o processo depois de confirmar.

- [ ] **Step 5: Commit**

```bash
git add backend/src/knowledge/knowledge.controller.ts backend/src/knowledge/knowledge.module.ts backend/src/app.module.ts
git commit -m "feat(knowledge): controller/module + registro no app"
```

---

### Task 5: Anexos de artigo — extensão de `AttachmentsService`/`AttachmentsController`

**Files:**
- Modify: `backend/src/attachments/attachments.service.ts`
- Modify: `backend/src/attachments/attachments.controller.ts`
- Modify: `backend/src/attachments/attachments.service.spec.ts`

**Interfaces:**
- Produces: `AttachmentsService.saveForArticle(articleId, file, actor)`,
  `.listForArticle(articleId)`; rotas
  `POST/GET /knowledge-articles/:id/attachments`; novo branch em
  `getForDownload` pra `articleId`.

- [ ] **Step 1: Escrever os testes que falham**

Em `backend/src/attachments/attachments.service.spec.ts`, no `makeDeps()`
(linhas 22-37), adicionar `knowledgeArticle: { findUnique: vi.fn() }` ao
objeto `prisma`:

```ts
function makeDeps() {
  const prisma = {
    attachment: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'at1', createdAt: new Date(), ...data }),
      ),
      findUnique: vi.fn(),
    },
    ticketComment: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
    visit: { findUnique: vi.fn() },
    knowledgeArticle: { findUnique: vi.fn() },
  };
  const tickets = { assertAccess: vi.fn().mockResolvedValue({ id: 't1' }) };
  const service = new AttachmentsService(prisma as any, tickets as any, diskStorage());
  return { service, prisma, tickets };
}
```

Adicionar ao final do arquivo:

```ts
describe('AttachmentsService.saveForArticle', () => {
  it('rejeita artigo inexistente → NotFoundException', async () => {
    const { service, prisma } = makeDeps();
    prisma.knowledgeArticle.findUnique.mockResolvedValue(null);
    await expect(service.saveForArticle('art1', png(), actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('persiste o anexo com articleId e devolve publicAttachment', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'att-'));
    const prev = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = dir;
    try {
      const { service, prisma } = makeDeps();
      prisma.knowledgeArticle.findUnique.mockResolvedValue({ id: 'art1' });

      const out = await service.saveForArticle('art1', png(), actor);

      expect(prisma.knowledgeArticle.findUnique).toHaveBeenCalledWith({
        where: { id: 'art1' },
        select: { id: true },
      });
      const persisted = prisma.attachment.create.mock.calls[0][0].data;
      expect(persisted.articleId).toBe('art1');
      expect(out).not.toHaveProperty('storedPath');
      expect(out).toMatchObject({ filename: 'foto.png', mime: 'image/png' });
    } finally {
      process.env.STORAGE_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AttachmentsService.getForDownload — anexo de artigo', () => {
  const clientActor = { id: 'c1', type: 'CLIENT', role: 'CLIENT', clientId: 'cli1' };

  it('cliente não baixa anexo de artigo (recurso interno)', async () => {
    const { service, prisma } = makeDeps();
    prisma.attachment.findUnique.mockResolvedValue({
      id: 'at1', ticketId: null, commentId: null, assetId: null, visitId: null, articleId: 'art1',
    });
    await expect(service.getForDownload('at1', clientActor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('agente baixa anexo de artigo', async () => {
    const { service, prisma } = makeDeps();
    const att = { id: 'at1', ticketId: null, commentId: null, assetId: null, visitId: null, articleId: 'art1' };
    prisma.attachment.findUnique.mockResolvedValue(att);
    await expect(service.getForDownload('at1', actor)).resolves.toBe(att);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
cd backend && npx vitest run src/attachments/attachments.service.spec.ts
```

Expected: FAIL nos 4 testes novos.

- [ ] **Step 3: Implementar — `AttachmentsService`**

Em `backend/src/attachments/attachments.service.ts`, adicionar os métodos
novos logo depois de `listForVisit` (mesmo padrão de `saveForAsset`/
`listForAsset`):

```ts
  /**
   * Anexa um arquivo a um artigo da base de conhecimento (manual, foto).
   * Recurso interno: só ADMIN/AGENT no controller. Não depende de
   * `KnowledgeService` — checa a existência direto pelo `prisma`, mesmo
   * padrão de `saveForAsset`/`saveForVisit`.
   */
  async saveForArticle(
    articleId: string,
    file: UploadedFile,
    actor: Actor,
  ): Promise<ReturnType<typeof publicAttachment>> {
    const article = await this.prisma.knowledgeArticle.findUnique({
      where: { id: articleId },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Artigo não encontrado.');
    return publicAttachment(await this.persist({ articleId }, file, actor));
  }

  listForArticle(articleId: string) {
    return this.prisma.attachment
      .findMany({ where: { articleId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map(publicAttachment));
  }
```

No método `private persist` (parâmetro `link`), adicionar `articleId` à
união de tipos:

```ts
  private async persist(
    link: { ticketId: string } | { commentId: string } | { assetId: string } | { visitId: string } | { articleId: string },
    file: UploadedFile,
    actor?: Actor,
    kind: 'GENERIC' | 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' | 'REPORT' = 'GENERIC',
  ): Promise<Attachment> {
```

Em `getForDownload`, adicionar o branch novo — mesma posição lógica dos já
existentes pra `assetId`/`visitId`, cada um checando os campos anteriores
como `null`:

```ts
    // Anexo de artigo da base de conhecimento: recurso interno. Cliente nunca baixa.
    if (!ticketId && !attachment.commentId && !attachment.assetId && !attachment.visitId && attachment.articleId) {
      if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
      return attachment;
    }
```

Insira este bloco logo depois do branch existente de `visitId` (antes do
`if (!ticketId) throw new NotFoundException(...)` final).

- [ ] **Step 4: Implementar — `AttachmentsController`**

Em `backend/src/attachments/attachments.controller.ts`, adicionar as duas
rotas novas logo depois de `listForVisit` (mesmo padrão de
`uploadToAsset`/`listForAsset`):

```ts
  // Anexo de artigo da base de conhecimento: recurso interno. O acesso é checado pelo @Roles.
  @Post('knowledge-articles/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  @UseInterceptors(interceptor)
  uploadToArticle(
    @Param('id') id: string,
    @UploadedFile() file: UF,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.attachments.saveForArticle(id, file, actor);
  }

  @Get('knowledge-articles/:id/attachments')
  @Roles('ADMIN', 'AGENT')
  listForArticle(@Param('id') id: string) {
    return this.attachments.listForArticle(id);
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
cd backend && npx vitest run src/attachments/attachments.service.spec.ts
```

Expected: PASS (todos os describes do arquivo, incluindo os já
existentes).

- [ ] **Step 6: Commit**

```bash
git add backend/src/attachments
git commit -m "feat(knowledge): anexos de artigo via AttachmentsService/Controller"
```

---

### Task 6: Integração (Postgres real) + CHANGELOG

**Files:**
- Create: `backend/src/knowledge/knowledge.integration.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:** nenhuma nova — exercita o que as Tasks 1-5 já produziram,
ponta a ponta com banco real.

- [ ] **Step 1: Escrever o teste de integração**

Criar `backend/src/knowledge/knowledge.integration.spec.ts`, no mesmo
padrão de `backend/src/contracts/contracts.integration.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { KnowledgeService } from './knowledge.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Artigo vinculado a categoria + tipo
// de ativo → sugestão bate num chamado com a mesma categoria/tipo de
// ativo. Sobe com `docker compose up -d postgres`. Sem banco no ar, pula
// com aviso (exit 0).
const PFX = `KB-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.knowledgeArticle.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.ticket.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.assetType.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.category.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Base de conhecimento — sugestão por categoria/tipo de ativo (Postgres real)', () => {
  let knowledge: KnowledgeService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[knowledge.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente`, emailDomains: [EMAIL_DOMAIN] } });
    const actorUser = await prisma.user.create({
      data: { email: `admin@${EMAIL_DOMAIN}`, name: `${PFX} Admin`, type: 'INTERNAL', role: 'ADMIN' },
    });
    const category = await prisma.category.create({ data: { name: `${PFX} Categoria` } });
    const assetType = await prisma.assetType.create({ data: { name: `${PFX} Tipo` } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Local` } });
    const asset = await prisma.asset.create({
      data: { clientId: client.id, locationId: location.id, typeId: assetType.id, label: `${PFX} Ativo` },
    });
    id.clientId = client.id;
    id.actorId = actorUser.id;
    id.categoryId = category.id;
    id.assetTypeId = assetType.id;
    id.assetId = asset.id;

    const prismaService = prisma as unknown as PrismaService;
    knowledge = new KnowledgeService(prismaService);

    await knowledge.create(
      { title: `${PFX} Artigo`, body: 'Procedimento de teste', categoryId: category.id, assetTypeId: assetType.id },
      { id: actorUser.id } as any,
    );

    await prisma.ticket.create({
      data: {
        title: `${PFX} Chamado`,
        description: 'desc',
        clientId: client.id,
        categoryId: category.id,
        origin: 'MANUAL',
        number: `${PFX}-0001`,
        assets: { connect: [{ id: asset.id }] },
      },
    });
  });

  afterAll(async () => {
    if (prisma && available) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('sugestão bate pelo artigo vinculado à mesma categoria e ao mesmo tipo de ativo', async () => {
    if (!available) return;

    const ticket = await prisma!.ticket.findFirst({ where: { title: `${PFX} Chamado` } });
    const suggestions = await knowledge.suggestFor(ticket!.id);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe(`${PFX} Artigo`);
  });
});
```

- [ ] **Step 2: Rodar**

```bash
cd backend && npx vitest run --config vitest.config.integration.ts src/knowledge/knowledge.integration.spec.ts
```

Expected: PASS se `docker compose up -d postgres` estiver no ar; pula com
aviso caso contrário.

- [ ] **Step 3: Atualizar o CHANGELOG**

Em `CHANGELOG.md`, na seção `## [Não lançado]` → `### Adicionado` (depois
da entrada do SLA real), adicionar:

```markdown
- **Base de conhecimento**: artigos de procedimento/manual vinculados
  opcionalmente a categoria e/ou tipo de ativo, com busca dedicada
  (`/app/base-conhecimento`) e sugestão automática na ficha do chamado.
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/knowledge/knowledge.integration.spec.ts CHANGELOG.md
git commit -m "test(knowledge): integracao de sugestao por categoria/tipo de ativo (Postgres real)"
```

---

### Task 7: Frontend — `lib/knowledge.ts` + lista + criar

**Files:**
- Create: `frontend/src/lib/knowledge.ts`
- Create: `frontend/src/app/app/base-conhecimento/page.tsx`
- Create: `frontend/src/app/app/base-conhecimento/novo/page.tsx`

**Interfaces:**
- Consumes: `GET/POST /knowledge-articles` (Task 4).
- Produces: `useArticles(filter)`, `useCreateArticle()` — consumidos pela
  Task 8 também (`useArticle`, `useUpdateArticle`, adicionados ali).

- [ ] **Step 1: Criar `lib/knowledge.ts`**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface KnowledgeArticleSummary {
  id: string;
  title: string;
  active: boolean;
  category: { id: string; name: string } | null;
  assetType: { id: string; name: string } | null;
}

export interface ArticleFilters {
  q?: string;
  categoryId?: string;
  assetTypeId?: string;
}

function toQuery(f: ArticleFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.categoryId) p.set('categoryId', f.categoryId);
  if (f.assetTypeId) p.set('assetTypeId', f.assetTypeId);
  return p.toString();
}

export function useArticles(filter: ArticleFilters) {
  return useQuery({
    queryKey: ['knowledge-articles', filter],
    queryFn: () => api<KnowledgeArticleSummary[]>(`/knowledge-articles?${toQuery(filter)}`),
  });
}

export interface CreateArticleInput {
  title: string;
  body: string;
  categoryId?: string;
  assetTypeId?: string;
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArticleInput) =>
      api<{ id: string }>('/knowledge-articles', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-articles'] }),
  });
}
```

- [ ] **Step 2: Criar a lista (`page.tsx`)**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useArticles } from '@/lib/knowledge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

export default function KnowledgeListPage() {
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');

  const { data: articles } = useArticles({ q: q || undefined, categoryId: categoryId || undefined, assetTypeId: assetTypeId || undefined });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Base de conhecimento</h1>
        <Link href="/app/base-conhecimento/novo">
          <Button className="h-9">Novo artigo</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por título ou texto"
          className="h-9 w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="h-9 w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select className="h-9 w-48" value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)}>
          <option value="">Todos os tipos de ativo</option>
          {assetTypes?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Tipo de ativo</th>
              <th className="px-3 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {articles?.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={`/app/base-conhecimento/${a.id}`} className="text-primary hover:underline">
                    {a.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.category?.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.assetType?.name ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={a.active ? 'green' : 'neutral'}>{a.active ? 'Ativo' : 'Inativo'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar a página de criação (`novo/page.tsx`)**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useCreateArticle } from '@/lib/knowledge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

export default function NewArticlePage() {
  const router = useRouter();
  const create = useCreateArticle();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });

  function submit() {
    if (!title.trim() || !body.trim()) {
      toast.error('Preencha título e corpo.');
      return;
    }
    create.mutate(
      { title: title.trim(), body: body.trim(), categoryId: categoryId || undefined, assetTypeId: assetTypeId || undefined },
      {
        onSuccess: (created) => {
          toast.success('Artigo criado.');
          router.replace(`/app/base-conhecimento/${created.id}`);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao criar artigo.'),
      },
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-lg font-semibold">Novo artigo</h1>
      <div className="flex flex-col gap-1.5">
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Corpo</Label>
        <textarea
          className="min-h-40 rounded-md border border-input bg-background p-2 text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Categoria</Label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Nenhuma</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Tipo de ativo</Label>
          <Select value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)}>
            <option value="">Nenhum</option>
            {assetTypes?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <Button className="h-9 w-fit" disabled={create.isPending} onClick={submit}>
        Criar artigo
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Testar manualmente**

```bash
cd frontend && npm run dev
```

Login como ADMIN, abrir `/app/base-conhecimento/novo`, criar um artigo,
conferir redirecionamento pro detalhe (ainda sem página própria — vai dar
404 até a Task 8; tudo bem, é esperado nesta task) e conferir que ele
aparece na lista em `/app/base-conhecimento`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/knowledge.ts frontend/src/app/app/base-conhecimento/page.tsx frontend/src/app/app/base-conhecimento/novo
git commit -m "feat(knowledge): lista e criacao de artigos no frontend"
```

---

### Task 8: Frontend — detalhe/edição + upload de anexo

**Files:**
- Modify: `frontend/src/lib/knowledge.ts`
- Create: `frontend/src/app/app/base-conhecimento/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET/PATCH /knowledge-articles/:id`,
  `POST/GET /knowledge-articles/:id/attachments` (Tasks 4-5).
- Produces: `useArticle(id)`, `useUpdateArticle(id)` — adicionados a
  `lib/knowledge.ts` junto do que a Task 7 já criou.

- [ ] **Step 1: Adicionar os hooks que faltam em `lib/knowledge.ts`**

```ts
export interface KnowledgeArticleDetail {
  id: string;
  title: string;
  body: string;
  active: boolean;
  categoryId: string | null;
  assetTypeId: string | null;
  category: { id: string; name: string } | null;
  assetType: { id: string; name: string } | null;
}

export function useArticle(id: string) {
  return useQuery({
    queryKey: ['knowledge-article', id],
    queryFn: () => api<KnowledgeArticleDetail>(`/knowledge-articles/${id}`),
    enabled: !!id,
  });
}

export interface UpdateArticleInput {
  title?: string;
  body?: string;
  categoryId?: string;
  assetTypeId?: string;
  active?: boolean;
}

export function useUpdateArticle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateArticleInput) =>
      api<KnowledgeArticleDetail>(`/knowledge-articles/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-article', id] });
      qc.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
  });
}
```

- [ ] **Step 2: Criar `[id]/page.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useArticle, useUpdateArticle } from '@/lib/knowledge';
import { downloadAttachment, type Attachment } from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export default function ArticleDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: article, isLoading, isError } = useArticle(id);
  const update = useUpdateArticle(id);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });
  const { data: attachments } = useQuery({
    queryKey: ['article-attachments', id],
    queryFn: () => api<Attachment[]>(`/knowledge-articles/${id}/attachments`),
    enabled: !!id,
  });

  useEffect(() => {
    if (!article) return;
    setTitle(article.title);
    setBody(article.body);
  }, [article]);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/knowledge-articles/${id}/attachments`, { method: 'POST', body: fd });
      qc.invalidateQueries({ queryKey: ['article-attachments', id] });
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Anexo enviado.');
    } catch (e) {
      onErr(e);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !article) return <p className="text-sm text-red-600">Artigo não encontrado.</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1 text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== article.title && update.mutate({ title: title.trim() }, { onError: onErr })}
        />
        <Badge tone={article.active ? 'green' : 'neutral'}>{article.active ? 'Ativo' : 'Inativo'}</Badge>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => update.mutate({ active: !article.active }, { onError: onErr })}
        >
          {article.active ? 'Desativar' : 'Ativar'}
        </Button>
      </div>

      <textarea
        className="min-h-40 rounded-md border border-input bg-background p-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => body.trim() && body !== article.body && update.mutate({ body: body.trim() }, { onError: onErr })}
      />

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Categoria</Label>
          <Select
            value={article.categoryId ?? ''}
            onChange={(e) => update.mutate({ categoryId: e.target.value }, { onError: onErr })}
          >
            <option value="">Nenhuma</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Tipo de ativo</Label>
          <Select
            value={article.assetTypeId ?? ''}
            onChange={(e) => update.mutate({ assetTypeId: e.target.value }, { onError: onErr })}
          >
            <option value="">Nenhum</option>
            {assetTypes?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Anexos</h2>
        <ul className="flex flex-col gap-1">
          {attachments?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => downloadAttachment(a.id, a.filename).catch(() => toast.error('Falha no download.'))}
                className="text-sm text-primary hover:underline"
              >
                📎 {a.filename}
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={fileRef}
          type="file"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Testar manualmente**

```bash
cd frontend && npm run dev
```

Abrir um artigo criado na Task 7, editar título/corpo, trocar
categoria/tipo de ativo, subir um anexo e baixar de volta, ativar/desativar
— conferir que tudo persiste após recarregar.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/knowledge.ts frontend/src/app/app/base-conhecimento/[id]
git commit -m "feat(knowledge): detalhe/edicao de artigo + upload de anexo"
```

---

### Task 9: Frontend — nav + sugestões na ficha do chamado

**Files:**
- Modify: `frontend/src/components/nav.tsx`
- Create: `frontend/src/components/knowledge-suggestions.tsx`
- Modify: `frontend/src/app/app/chamados/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /knowledge-articles/suggestions?ticketId=` (Task 4).

- [ ] **Step 1: Adicionar o item no nav**

Em `frontend/src/components/nav.tsx`, na função `appLinks` (linhas 10-27),
adicionar "Base de conhecimento" à lista principal (depois de
`Configurações`, já que não é um recurso do dia a dia como Fila/Agenda):

```ts
function appLinks(role: string | undefined) {
  const links = [
    { href: '/app', label: 'Fila' },
    { href: '/app/agenda', label: 'Agenda' },
  ];
  if (role === 'ADMIN' || role === 'AGENT') links.unshift({ href: '/app/dashboard', label: 'Dashboard' });
  if (role === 'AGENT') links.push({ href: '/app/campo', label: 'Campo' });
  links.push(
    { href: '/app/clientes', label: 'Clientes' },
    { href: '/app/contratos', label: 'Contratos' },
    { href: '/app/catalogo', label: 'Catálogo' },
    { href: '/app/estoque', label: 'Estoque' },
    { href: '/app/orcamentos', label: 'Orçamentos' },
    { href: '/app/ativos', label: 'Ativos' },
  );
  if (role === 'ADMIN' || role === 'AGENT') {
    links.push({ href: '/app/base-conhecimento', label: 'Base de conhecimento' });
  }
  links.push({ href: '/app/config', label: 'Configurações' });
  return links;
}
```

- [ ] **Step 2: Criar `KnowledgeSuggestions`**

Criar `frontend/src/components/knowledge-suggestions.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Suggestion {
  id: string;
  title: string;
}

export function KnowledgeSuggestions({ ticketId }: { ticketId: string }) {
  const { data } = useQuery({
    queryKey: ['knowledge-suggestions', ticketId],
    queryFn: () => api<Suggestion[]>(`/knowledge-articles/suggestions?ticketId=${ticketId}`),
  });

  if (!data || data.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Artigos relacionados</h2>
      <ul className="flex flex-col gap-1">
        {data.map((a) => (
          <li key={a.id}>
            <Link href={`/app/base-conhecimento/${a.id}`} className="text-sm text-primary hover:underline">
              📄 {a.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Inserir na ficha do chamado**

Em `frontend/src/app/app/chamados/[id]/page.tsx`, adicionar o import junto
dos outros componentes (linha 28, depois de `TicketSatisfaction`):

```ts
import { KnowledgeSuggestions } from '@/components/knowledge-suggestions';
```

E inserir `<KnowledgeSuggestions ticketId={id} />` logo depois de
`<TicketSatisfaction ticket={ticket} />` (linha 307) e antes da seção
"Movimentações":

```tsx
          <TicketSatisfaction ticket={ticket} />

          <KnowledgeSuggestions ticketId={id} />

          <section>
            <h2 className="mb-2 text-sm font-semibold">Movimentações</h2>
```

- [ ] **Step 4: Testar manualmente**

Abrir um chamado cuja categoria bate com o artigo criado nas Tasks 7-8,
conferir que o bloco "Artigos relacionados" aparece com o link certo; abrir
um chamado sem categoria/ativo compatível e conferir que o bloco não
aparece.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/nav.tsx frontend/src/components/knowledge-suggestions.tsx frontend/src/app/app/chamados/[id]/page.tsx
git commit -m "feat(knowledge): nav + sugestoes de artigo na ficha do chamado"
```

---

### Task 10: E2E — criar artigo, buscar, anexar, ver sugestão no chamado

**Files:**
- Create: `frontend/e2e/base-conhecimento.spec.ts`

**Interfaces:** nenhuma nova — smoke test ponta a ponta via UI.

- [ ] **Step 1: Escrever o teste**

Criar `frontend/e2e/base-conhecimento.spec.ts`, no mesmo padrão de
`frontend/e2e/csat-pos-chamado.spec.ts`:

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

test('cria artigo, aparece na busca e como sugestão num chamado da mesma categoria', async ({ page }) => {
  test.setTimeout(60_000);
  const titulo = `Artigo E2E ${Date.now()}`;

  await loginAsAdmin(page);

  // Criação — sem categoria/tipo de ativo (o objetivo aqui é a busca e o
  // CRUD básico; a checagem da sugestão automática usa o próprio texto de
  // busca como proxy simples, evitando depender de uma categoria fixa do
  // seed).
  await page.goto('/app/base-conhecimento/novo');
  await page.locator('#title, input').first().fill(titulo);
  await page.locator('textarea').fill('Procedimento de teste E2E.');
  await page.getByRole('button', { name: 'Criar artigo' }).click();
  await page.waitForURL(/\/app\/base-conhecimento\/(?!novo)[^/]+$/);

  // Upload de anexo
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'manual.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('conteúdo de teste'),
  });
  await expect(page.getByText('manual.txt')).toBeVisible();

  // Busca
  await page.goto('/app/base-conhecimento');
  await page.getByPlaceholder('Buscar por título ou texto').fill(titulo);
  await expect(page.getByRole('link', { name: titulo })).toBeVisible();
});
```

- [ ] **Step 2: Rodar**

```bash
cd frontend && npx playwright test e2e/base-conhecimento.spec.ts
```

Expected: PASS. Se o seletor do campo de título não bater (`#title,
input`), ajuste conforme o HTML real do form da Task 7 — não pule o teste.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/base-conhecimento.spec.ts
git commit -m "test(e2e): fumaca de criacao/busca/anexo da base de conhecimento"
```

---

## Execução

Duas opções, conforme `writing-plans`:

1. **Subagent-Driven** (recomendado) — subagente novo por task, revisão
   entre tasks, iteração rápida.
2. **Inline Execution** — execução em lote nesta sessão via
   `executing-plans`, com checkpoints.
