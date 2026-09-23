# Base de conhecimento (Fase 0.7.0 — parte 4/4)

Data: 2026-09-22
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `5634213` (SLA real, 0.7.0 parte 3/4)
Roadmap: `docs/roadmap.md` — 0.7.0 "Gestão, SLA real e satisfação" — "Base de
conhecimento (procedimentos, manuais por modelo de equipamento)"

## 1. Objetivo

Dar aos agentes/técnicos um lugar pra documentar e encontrar procedimentos
operacionais e manuais por modelo de equipamento, com busca dedicada e
sugestão automática na ficha do chamado. Esta é a quarta e última das
partes pouco acopladas da fase 0.7.0 (CSAT —
`docs/superpowers/specs/2026-09-20-csat-pos-chamado-design.md`; Dashboard —
`docs/superpowers/specs/2026-09-21-dashboard-gestao-design.md`; SLA real —
`docs/superpowers/specs/2026-09-22-sla-real-design.md`).

Entregas:

1. **Model `KnowledgeArticle`**: título, corpo em texto simples, vínculo
   opcional a categoria e/ou tipo de ativo, anexos opcionais (reaproveita
   `Attachment`), autoria, ativo/inativo.
2. **CRUD** (`ADMIN`/`AGENT`): criar, listar com busca simples (título/corpo)
   e filtro por categoria/tipo de ativo, ver/editar, upload/listagem de
   anexos.
3. **Sugestão automática na ficha do chamado**: artigos cuja categoria ou
   tipo de ativo batem com o chamado aberto.
4. **Frontend**: tela de busca dedicada (`/app/base-conhecimento`), criação,
   detalhe/edição, bloco de sugestões na ficha do chamado, item no nav.

Fora de escopo (adiado): editor de texto rico/markdown (corpo é texto
simples, mesmo padrão de `Ticket.description`); busca full-text
(`tsvector`) — busca simples por `contains`; artigos visíveis no portal do
cliente (só interno nesta fase); versionamento de artigo; exclusão
definitiva (só `active: false`).

## 2. Decisões travadas (do brainstorm)

- **Corpo em texto + anexos opcionais.** Cobre tanto "procedimento" (texto
  escrito pela equipe) quanto "manual" (PDF do fabricante anexado) sem
  precisar de duas entidades diferentes.
- **Vínculo por categoria E/OU tipo de ativo, ambos opcionais** — mesmo
  padrão flexível já usado em `ChecklistTemplate.categoryId`. Um artigo sem
  nenhum dos dois é um procedimento genérico, só encontrável por busca
  manual.
- **Só interno (`ADMIN`/`AGENT`)** — sem exposição no portal do cliente
  nesta fase. Se precisar depois, vira uma flag `visibleToClient` — não
  antecipado agora (YAGNI).
- **Busca dedicada + sugestão automática na ficha do chamado** — cobre os
  dois cenários de uso reais: pesquisa deliberada e "o técnico está atendendo
  agora e quer o manual na hora".
- **`ADMIN` e `AGENT` podem criar/editar** — mesmo nível de acesso de
  Catálogo/Checklists hoje; qualquer um documenta, sem depender só do admin.
- **Busca simples (`contains`, case-insensitive)** em título e corpo — mesmo
  padrão já usado no `?q=` de Chamados. Sem `tsvector`/índice GIN — volume
  esperado (dezenas/centenas de artigos) não justifica a complexidade extra.

## 3. Arquitetura

### 3.1 Schema

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

`Category` e `AssetType` ganham a relação reversa `knowledgeArticles
KnowledgeArticle[]`; `User` ganha `knowledgeArticles KnowledgeArticle[]`.

`Attachment` ganha `articleId String?` + relação
`article KnowledgeArticle? @relation(fields: [articleId], references: [id], onDelete: Cascade)`
+ `@@index([articleId])` — mesmo padrão de `ticketId`/`commentId`/`assetId`/`visitId`,
todos opcionais e em cascata. Nenhuma tabela de anexo nova.

`body` é `String` simples (texto puro, sem markdown renderizado) — mesmo
padrão de `Ticket.description`. Não há dependência de editor de texto rico
no frontend hoje; introduzir uma só para isto seria escopo além do pedido.

### 3.2 Backend — módulo `knowledge`

```
backend/src/
  knowledge/
    dto/create-article.dto.ts
    dto/update-article.dto.ts
    knowledge.service.ts
    knowledge.controller.ts
    knowledge.module.ts
    knowledge.service.spec.ts
```

`KnowledgeModule` importa `PrismaModule` (padrão global já usado nos outros
módulos). Sem dependência de `TicketsService`/`ContractsService`.

**`KnowledgeService`:**

```ts
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
  return this.prisma.knowledgeArticle.update({
    where: { id },
    data: {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.body !== undefined ? { body: dto.body } : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
      ...(dto.assetTypeId !== undefined ? { assetTypeId: dto.assetTypeId || null } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    },
  });
}

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

### 3.3 Rotas (`@Controller('knowledge-articles')`)

- `GET /knowledge-articles?q=&categoryId=&assetTypeId=` — `@Roles('ADMIN','AGENT')`
- `POST /knowledge-articles` — `@Roles('ADMIN','AGENT')`
- `GET /knowledge-articles/suggestions?ticketId=` — `@Roles('ADMIN','AGENT')`
  (registrada **antes** de `:id` no controller, senão `suggestions` seria
  interpretado como um `id`)
- `GET /knowledge-articles/:id` — `@Roles('ADMIN','AGENT')`
- `PATCH /knowledge-articles/:id` — `@Roles('ADMIN','AGENT')`

Sem `DELETE` nesta fase — só `active: false` via `PATCH`, mesmo padrão do
resto do sistema (nada tem hard-delete hoje).

### 3.4 Anexos — extensão de `AttachmentsService`/`AttachmentsController`

`AttachmentsService.persist`'s `link` union ganha `{ articleId: string }`.
Novos métodos, mesmo padrão de `saveForAsset`/`listForAsset`:

```ts
async saveForArticle(articleId: string, file: UploadedFile, actor: Actor) {
  const article = await this.prisma.knowledgeArticle.findUnique({
    where: { id: articleId }, select: { id: true },
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

Novas rotas em `AttachmentsController` (mesmo padrão de ativos):
- `POST /knowledge-articles/:id/attachments` — `@Roles('ADMIN','AGENT')`
- `GET /knowledge-articles/:id/attachments` — `@Roles('ADMIN','AGENT')`

`AttachmentsService.getForDownload` ganha um branch novo, mesma posição dos
já existentes pra `assetId`/`visitId` (recurso interno, `CLIENT` nunca
baixa):

```ts
if (!ticketId && !attachment.commentId && !attachment.assetId && !attachment.visitId && attachment.articleId) {
  if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
  return attachment;
}
```

### 3.5 Frontend

```
frontend/src/app/app/base-conhecimento/
  page.tsx        # lista + busca (?q=) + filtro categoria/tipo de ativo
  novo/page.tsx   # criar artigo
  [id]/page.tsx   # ver/editar + anexos
frontend/src/lib/knowledge.ts   # tipos + hooks
```

- **Lista** (`page.tsx`): campo de busca + 2 selects de filtro opcionais
  (categoria, tipo de ativo). Tabela: título, categoria, tipo de ativo,
  badge Ativo/Inativo. Botão "Novo artigo" (mesmo padrão de Contratos).
- **Criar** (`novo/page.tsx`): título, `<textarea>` pro corpo, selects de
  categoria/tipo de ativo (opção "Nenhuma(um)"). Redireciona pro detalhe
  após criar.
- **Detalhe** (`[id]/page.tsx`): título/corpo/categoria/tipo de ativo
  editáveis (onBlur-save, mesmo padrão de Categorias), toggle
  Ativo/Inativo, lista de anexos + upload inline (mesmo padrão inline já
  usado em `frontend/src/app/app/ativos/[id]/page.tsx` — `FormData` direto
  na mutation, sem componente compartilhado novo).
- **Nav**: item "Base de conhecimento" em `AppNav`
  (`frontend/src/components/nav.tsx`), visível pra `ADMIN`/`AGENT` (mesma
  condição já usada pro Dashboard).
- **Bloco na ficha do chamado**: componente novo `KnowledgeSuggestions`,
  busca `GET /knowledge-articles/suggestions?ticketId=`, renderiza links
  pro artigo; não renderiza nada se a lista vier vazia (mesmo padrão de
  `VisitsBlock` em `chamados/[id]/page.tsx`).

## 4. Erros e casos de borda

- Artigo sem categoria nem tipo de ativo → nunca aparece nas sugestões
  automáticas, mas continua na busca manual — é o caso do procedimento
  genérico.
- Chamado sem categoria e sem ativos vinculados → `suggestFor` devolve
  `[]` sem erro (curto-circuito explícito antes de montar o `OR`, pra não
  deixar o Prisma interpretar `OR: []` como "sem filtro").
- Categoria/tipo de ativo inativado (não excluído) → não afeta o artigo,
  mesmo padrão de contrato/categoria inativos em outras partes do sistema.
- Artigo `active: false` → some das sugestões automáticas (`suggestFor`
  filtra `active: true`), mas continua listado na busca/lista de gestão
  (`/app/base-conhecimento`) com o badge "Inativo" — mesmo padrão já usado
  nas telas de gestão de Categoria/Tipo de ativo/Checklist deste sistema
  (listam tudo, pra quem administra poder reativar) — e continua acessível
  por link direto (`/app/base-conhecimento/:id`).
- Anexo de artigo: mesmas regras já existentes de `AttachmentsService`
  (10 MB, mimes permitidos) — nenhuma regra nova.
- Download de anexo de artigo por `CLIENT` → `NotFoundException` (recurso
  interno, não vaza existência).
- Rota `GET /knowledge-articles/suggestions` precisa vir **antes** de
  `GET /knowledge-articles/:id` no controller (ordem de declaração no
  NestJS importa — rota mais específica primeiro).

## 5. Testes

Unit (Vitest):
- `knowledge.service.spec.ts` — `findAll` com/sem `q`/`categoryId`/`assetTypeId`
  combinados; `create` grava `createdById`; `update` parcial (só os campos
  enviados mudam); `suggestFor` — bate por categoria, bate por tipo de
  ativo, bate pelos dois, chamado sem nenhum dos dois devolve `[]`, artigo
  inativo nunca aparece.
- `attachments.service.spec.ts` — novo branch de `getForDownload` pra
  `articleId` (interno; `CLIENT` recebe `NotFoundException`).

Integração (Postgres real):
- Cria categoria + tipo de ativo + artigo vinculado aos dois + chamado com
  essa categoria e um ativo desse tipo → `suggestFor` devolve o artigo.

E2E Playwright (fumaça):
- Criar artigo, buscar por título na lista, abrir, subir um anexo, conferir
  que aparece; abrir um chamado da mesma categoria e conferir que o artigo
  aparece no bloco de sugestões.

## 6. Sequência de implementação (rascunho pro plano)

1. Migração: `KnowledgeArticle` + `Attachment.articleId` + relações
   reversas em `Category`/`AssetType`/`User`.
2. `KnowledgeService` — `findAll`/`create`/`findOne`/`update` + testes.
3. `KnowledgeService.suggestFor` + testes.
4. `knowledge.controller`/`knowledge.module` + registro em `app.module.ts`.
5. `AttachmentsService`/`AttachmentsController` — `saveForArticle`/
   `listForArticle`/rotas + branch de `getForDownload` + testes.
6. Integração + CHANGELOG.
7. Frontend: `lib/knowledge.ts` + lista + criar.
8. Frontend: detalhe/edição + upload de anexo.
9. Frontend: nav + `KnowledgeSuggestions` na ficha do chamado.
10. Frontend: E2E.
11. Release da fase 0.7.0 inteira (as 4 partes completas) — bump de versão
    e tag, primeira vez desde a 0.6.0.

## 7. Versão

Esta é a última parte da 0.7.0 — ao final desta implementação, a fase
inteira (CSAT + Dashboard + SLA real + Base de conhecimento) fecha com bump
de versão e tag (a decidir o número exato — provavelmente `0.7.0` — e
confirmar com o usuário antes do deploy, mesmo padrão das fases anteriores).
Nenhuma env nova.
