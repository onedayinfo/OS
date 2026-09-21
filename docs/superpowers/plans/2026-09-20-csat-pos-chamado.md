# CSAT pós-chamado (Fase 0.7.0 — parte 1/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao fechar um chamado, criar automaticamente uma pesquisa de satisfação (nota 1–5 + comentário opcional), mandar e-mail com link público pro solicitante, e mostrar a resposta na ficha do chamado.

**Architecture:** Módulo `surveys` novo e independente (segue exatamente o padrão de `quotes`/`contracts`): um model `TicketSatisfactionSurvey` com `publicToken` opaco, um controller `@Public()` pra GET/POST por token, e um hook dentro da transação já existente de `TicketsService.changeStatus` que cria o registro quando o chamado fecha. `TicketNotifier` ganha um método novo (`surveyRequested`) implementado em `NotificationsService`, reaproveitando o `EmailService`/`templates.ts` já existentes.

**Tech Stack:** NestJS (ESM, imports relativos terminam em `.js`) + Prisma 6 + PostgreSQL; Next.js 14 App Router + React Query; Vitest (unit com Prisma mockado; `*.integration.spec.ts` com Postgres real); Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-20-csat-pos-chamado-design.md`

## Global Constraints

- ESM em todo o backend: imports relativos sempre terminam em `.js`.
- **Nunca `import type` para uma classe usada como tipo de parâmetro de construtor** — apaga a referência de runtime que o Nest precisa pra injeção de dependência. `SurveysService` injetado em `TicketsService` precisa de `import { SurveysService }` de valor.
- IDs Prisma: `String @id @default(cuid())`. `publicToken`: `randomBytes(24).toString('hex')`, mesmo padrão de `Quote.publicToken`.
- Migração é só aditiva — sem backfill.
- Rota pública usa `@Public()` (`backend/src/common/public.decorator.ts`), fora de qualquer `@Roles`.
- Testes unit: Vitest, `PrismaService` mockado com `vi.fn()`. Testes de integração exigem Postgres, ficam em `*.integration.spec.ts`, pulam com aviso se `prisma.$connect()` falhar.
- Criação do registro de pesquisa roda **dentro** da mesma transação Prisma que já grava a mudança de status do chamado; o envio do e-mail roda **depois** do commit, dentro do wrapper `notify()` que já existe em `TicketsService` (não propaga erro).

---

## Task 1: Schema Prisma — `TicketSatisfactionSurvey` + migração

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_ticket_satisfaction_surveys/migration.sql` (gerada)

**Interfaces:**
- Produces: model `TicketSatisfactionSurvey`; `Ticket.satisfactionSurvey` (relação reversa).

- [ ] **Step 1: Editar `schema.prisma` — modelo novo**

Adicionar depois do `model Ticket { ... }` (antes do `model TicketComment`):

```prisma
model TicketSatisfactionSurvey {
  id          String    @id @default(cuid())
  ticketId    String    @unique
  publicToken String    @unique
  score       Int?
  comment     String?
  sentAt      DateTime  @default(now())
  respondedAt DateTime?

  ticket Ticket @relation(fields: [ticketId], references: [id])

  @@map("ticket_satisfaction_surveys")
}
```

- [ ] **Step 2: Editar `schema.prisma` — `Ticket` ganha a relação reversa**

No `model Ticket`, depois de `materialUsages TicketMaterialUsage[]`:

```prisma
  satisfactionSurvey TicketSatisfactionSurvey?
```

- [ ] **Step 3: Validar e gerar a migração**

Rodar em `C:/Users/renan/os-exec/backend`:

```bash
npx prisma validate
npx prisma migrate dev --name add_ticket_satisfaction_surveys
npx prisma generate
```

Expected: migração criada e aplicada sem erro; client regenerado com
`TicketSatisfactionSurvey`.

- [ ] **Step 4: Build de sanidade**

Run: `npm run build`
Expected: `nest build` compila sem erro de tipo.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(surveys): schema da pesquisa de satisfação por chamado"
```

---

## Task 2: `SurveysService` — criação da pesquisa

**Files:**
- Create: `backend/src/surveys/surveys.service.ts`
- Create: `backend/src/surveys/surveys.service.spec.ts`

**Interfaces:**
- Produces: `SurveysService.createForTicket(tx: Prisma.TransactionClient, ticket: Ticket): Promise<TicketSatisfactionSurvey | null>`.

- [ ] **Step 1: Escrever o teste falhando**

`backend/src/surveys/surveys.service.spec.ts`:

```ts
import { SurveysService } from './surveys.service.js';

describe('SurveysService.createForTicket', () => {
  it('não cria nada se o chamado não tem solicitante', async () => {
    const tx = { ticketSatisfactionSurvey: { findUnique: vi.fn(), create: vi.fn() } } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: null } as any);
    expect(result).toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it('não duplica se já existe pesquisa pro chamado', async () => {
    const tx = {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1' }),
        create: vi.fn(),
      },
    } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: 'u1' } as any);
    expect(result).toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).not.toHaveBeenCalled();
  });

  it('cria a pesquisa com token quando há solicitante e ainda não existe uma', async () => {
    const tx = {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's1', ...data })),
      },
    } as any;
    const service = new SurveysService({} as any);
    const result = await service.createForTicket(tx, { id: 't1', requesterId: 'u1' } as any);
    expect(result).not.toBeNull();
    expect(tx.ticketSatisfactionSurvey.create).toHaveBeenCalledWith({
      data: { ticketId: 't1', publicToken: expect.any(String) },
    });
    expect(result!.publicToken).toHaveLength(48);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- surveys.service.spec.ts`
Expected: FAIL — `Cannot find module './surveys.service.js'`.

- [ ] **Step 3: Implementar `SurveysService.createForTicket`**

`backend/src/surveys/surveys.service.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, Ticket, TicketSatisfactionSurvey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SurveysService {
  constructor(private readonly prisma: PrismaService) {}

  async createForTicket(
    tx: Prisma.TransactionClient,
    ticket: Pick<Ticket, 'id' | 'requesterId'>,
  ): Promise<TicketSatisfactionSurvey | null> {
    if (!ticket.requesterId) return null;
    const existing = await tx.ticketSatisfactionSurvey.findUnique({
      where: { ticketId: ticket.id },
    });
    if (existing) return null;
    return tx.ticketSatisfactionSurvey.create({
      data: { ticketId: ticket.id, publicToken: randomBytes(24).toString('hex') },
    });
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- surveys.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/surveys
git commit -m "feat(surveys): criação da pesquisa ao fechar o chamado"
```

---

## Task 3: `SurveysService` — resposta pública

**Files:**
- Create: `backend/src/surveys/dto/respond-survey.dto.ts`
- Modify: `backend/src/surveys/surveys.service.ts`
- Modify: `backend/src/surveys/surveys.service.spec.ts`

**Interfaces:**
- Produces: `SurveysService.findByToken(token: string)`, `SurveysService.respond(token: string, dto: RespondSurveyDto)`.

- [ ] **Step 1: DTO**

`backend/src/surveys/dto/respond-survey.dto.ts`:

```ts
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class RespondSurveyDto {
  @IsInt() @Min(1) @Max(5) score!: number;
  @IsOptional() @IsString() comment?: string;
}
```

- [ ] **Step 2: Escrever o teste falhando**

Adicionar a `surveys.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';

describe('SurveysService.findByToken / respond', () => {
  function makePrisma(overrides: Record<string, unknown> = {}) {
    return {
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          ticketId: 't1',
          publicToken: 'tok123',
          score: null,
          comment: null,
          respondedAt: null,
          ticket: { number: '2026-0001', title: 'PC não liga' },
        }),
        update: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 's1', ...data })),
      },
      ...overrides,
    };
  }

  it('findByToken lança NotFoundException pra token inexistente', async () => {
    const prisma = makePrisma({ ticketSatisfactionSurvey: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new SurveysService(prisma as any);
    await expect(service.findByToken('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findByToken devolve os dados pro front decidir o que mostrar', async () => {
    const prisma = makePrisma();
    const service = new SurveysService(prisma as any);
    const result = await service.findByToken('tok123');
    expect(result).toEqual({
      ticketNumber: '2026-0001',
      ticketTitle: 'PC não liga',
      score: null,
      comment: null,
      respondedAt: null,
    });
  });

  it('respond grava score/comment/respondedAt', async () => {
    const prisma = makePrisma();
    const service = new SurveysService(prisma as any);
    await service.respond('tok123', { score: 4, comment: 'Ótimo atendimento' });
    expect(prisma.ticketSatisfactionSurvey.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { score: 4, comment: 'Ótimo atendimento', respondedAt: expect.any(Date) },
    });
  });

  it('respond rejeita responder duas vezes', async () => {
    const prisma = makePrisma({
      ticketSatisfactionSurvey: {
        findUnique: vi.fn().mockResolvedValue({ id: 's1', respondedAt: new Date(), ticket: {} }),
        update: vi.fn(),
      },
    });
    const service = new SurveysService(prisma as any);
    await expect(service.respond('tok123', { score: 3 })).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- surveys.service.spec.ts`
Expected: FAIL — `service.findByToken is not a function`.

- [ ] **Step 4: Implementar `findByToken` e `respond`**

Adicionar a `backend/src/surveys/surveys.service.ts` (import `ConflictException`,
`NotFoundException` de `@nestjs/common`; import `RespondSurveyDto`):

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
// ...
import { RespondSurveyDto } from './dto/respond-survey.dto.js';
```

```ts
  private async mustFindByToken(token: string) {
    const survey = await this.prisma.ticketSatisfactionSurvey.findUnique({
      where: { publicToken: token },
      include: { ticket: { select: { number: true, title: true } } },
    });
    if (!survey) throw new NotFoundException('Pesquisa não encontrada.');
    return survey;
  }

  async findByToken(token: string) {
    const survey = await this.mustFindByToken(token);
    return {
      ticketNumber: survey.ticket.number,
      ticketTitle: survey.ticket.title,
      score: survey.score,
      comment: survey.comment,
      respondedAt: survey.respondedAt,
    };
  }

  async respond(token: string, dto: RespondSurveyDto) {
    const survey = await this.mustFindByToken(token);
    if (survey.respondedAt) {
      throw new ConflictException('Pesquisa já respondida.');
    }
    return this.prisma.ticketSatisfactionSurvey.update({
      where: { id: survey.id },
      data: { score: dto.score, comment: dto.comment ?? null, respondedAt: new Date() },
    });
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm run test -- surveys.service.spec.ts`
Expected: PASS (7 testes no total).

- [ ] **Step 6: Commit**

```bash
git add backend/src/surveys
git commit -m "feat(surveys): resposta pública por token, idempotente"
```

---

## Task 4: `surveys-public.controller` + `surveys.module` + registro no `app.module.ts`

**Files:**
- Create: `backend/src/surveys/surveys-public.controller.ts`
- Create: `backend/src/surveys/surveys.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SurveysService.findByToken`, `.respond` (Task 3).
- Produces: rotas HTTP públicas de `surveys`.

- [ ] **Step 1: `SurveysPublicController`**

`backend/src/surveys/surveys-public.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { SurveysService } from './surveys.service.js';
import { RespondSurveyDto } from './dto/respond-survey.dto.js';

@Controller('public/surveys')
@Public()
export class SurveysPublicController {
  constructor(private readonly surveys: SurveysService) {}

  @Get(':token')
  find(@Param('token') token: string) {
    return this.surveys.findByToken(token);
  }

  @Post(':token')
  respond(@Param('token') token: string, @Body() dto: RespondSurveyDto) {
    return this.surveys.respond(token, dto);
  }
}
```

- [ ] **Step 2: `SurveysModule`**

`backend/src/surveys/surveys.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { SurveysPublicController } from './surveys-public.controller.js';
import { SurveysService } from './surveys.service.js';

@Module({
  controllers: [SurveysPublicController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
```

- [ ] **Step 3: Registrar no `app.module.ts`**

Adicionar o import e registrar `SurveysModule` no array `imports`:

```ts
import { SurveysModule } from './surveys/surveys.module.js';
```

```ts
    SurveysModule,
```

- [ ] **Step 4: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 5: Commit**

```bash
git add backend/src/surveys backend/src/app.module.ts
git commit -m "feat(surveys): rotas públicas de pesquisa de satisfação"
```

---

## Task 5: `TicketNotifier.surveyRequested` + template de e-mail

**Files:**
- Modify: `backend/src/tickets/ticket-notifier.ts`
- Modify: `backend/src/email/templates.ts`
- Modify: `backend/src/notifications/notifications.service.ts`
- Create: `backend/src/notifications/notifications.service.spec.ts` (se não existir; senão adicionar aos testes existentes)

**Interfaces:**
- Consumes: `EmailService.send`, `NotificationsService.deliver` (já existentes).
- Produces: `TicketNotifier.surveyRequested(ticket, survey)`; template
  `satisfactionSurvey(ticket, link, brand?): RenderedEmail`.

- [ ] **Step 1: Verificar se já existe teste do `NotificationsService`**

Rodar: `ls backend/src/notifications/*.spec.ts`. Se existir um arquivo, os
próximos steps de teste vão nele; se não existir, criar
`notifications.service.spec.ts` do zero seguindo o Step 2 abaixo.

- [ ] **Step 2: Escrever o teste falhando**

Em `backend/src/notifications/notifications.service.spec.ts` (criar ou
adicionar a um `describe` novo no arquivo existente):

```ts
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService.surveyRequested', () => {
  function makeDeps(overrides: Record<string, unknown> = {}) {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', email: 'cliente@acme.com' }) },
      ...overrides,
    };
    const email = {
      brand: vi.fn().mockResolvedValue({}),
      send: vi.fn().mockResolvedValue(undefined),
    };
    return { prisma, email };
  }

  it('manda e-mail pro solicitante com o link da pesquisa', async () => {
    const { prisma, email } = makeDeps();
    const service = new NotificationsService(prisma as any, email as any);
    const ticket = { number: '2026-0001', requesterId: 'u1' } as any;
    const survey = { publicToken: 'tok123' } as any;
    await service.surveyRequested(ticket, survey);
    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'cliente@acme.com' }),
    );
  });

  it('não faz nada se o chamado não tem solicitante', async () => {
    const { prisma, email } = makeDeps({ user: { findUnique: vi.fn().mockResolvedValue(null) } });
    const service = new NotificationsService(prisma as any, email as any);
    await service.surveyRequested({ number: '2026-0001', requesterId: null } as any, { publicToken: 'tok123' } as any);
    expect(email.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm run test -- notifications.service.spec.ts`
Expected: FAIL — `service.surveyRequested is not a function`.

- [ ] **Step 4: Template de e-mail**

Em `backend/src/email/templates.ts`, adicionar (perto de `contactInvite`):

```ts
export function satisfactionSurvey(
  ticket: Pick<Ticket, 'number' | 'title'>,
  link: string,
  brand?: BrandInfo,
): RenderedEmail {
  return {
    subject: `Como foi o atendimento do chamado ${ticketRef(ticket)}?`,
    html: wrap(
      'Sua opinião é importante',
      `<p>O chamado <strong>${esc(ticket.title)}</strong> ${ticketRef(ticket)} foi encerrado.</p>` +
        `<p>Avalie o atendimento (leva menos de 1 minuto):</p>` +
        `<p><a href="${esc(link)}">${esc(link)}</a></p>`,
      brand,
    ),
  };
}
```

- [ ] **Step 5: `TicketNotifier` — método novo na interface**

`backend/src/tickets/ticket-notifier.ts`:

```ts
import type { Ticket, TicketComment, TicketSatisfactionSurvey } from '@prisma/client';

export interface TicketNotifier {
  created(ticket: Ticket): Promise<void>;
  resolved(ticket: Ticket): Promise<void>;
  assigned(ticket: Ticket): Promise<void>;
  publicComment(ticket: Ticket, comment: TicketComment): Promise<void>;
  slaBreached(ticket: Ticket): Promise<void>;
  surveyRequested(ticket: Ticket, survey: TicketSatisfactionSurvey): Promise<void>;
}
```

- [ ] **Step 6: Implementar em `NotificationsService`**

Em `backend/src/notifications/notifications.service.ts`, adicionar ao
import de `../email/templates.js`:

```ts
import {
  ticketAssigned,
  ticketComment,
  ticketCreated,
  ticketCreatedInternal,
  ticketResolved,
  ticketSlaBreached,
  satisfactionSurvey,
  type RenderedEmail,
} from '../email/templates.js';
```

E adicionar ao import de `@prisma/client`:

```ts
import type { Ticket, TicketComment, TicketSatisfactionSurvey, User } from '@prisma/client';
```

Adicionar o método (perto de `resolved`):

```ts
  async surveyRequested(ticket: Ticket, survey: TicketSatisfactionSurvey): Promise<void> {
    const requester = await this.userById(ticket.requesterId);
    if (!requester) return;
    const link = `${process.env.PORTAL_URL}/pesquisa/${survey.publicToken}`;
    await this.deliver(requester.email, satisfactionSurvey(ticket, link, await this.email.brand()), ticket);
  }
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `npm run test -- notifications.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro (a interface `TicketNotifier` ganhou um método
novo — qualquer outra implementação da interface, se existir, precisaria
implementá-lo também; a única implementação real é `NotificationsService`,
já atualizada).

- [ ] **Step 9: Commit**

```bash
git add backend/src/tickets/ticket-notifier.ts backend/src/email/templates.ts backend/src/notifications
git commit -m "feat(surveys): notificação por e-mail com link da pesquisa"
```

---

## Task 6: `TicketsService.changeStatus` — hook de criação da pesquisa

**Files:**
- Modify: `backend/src/tickets/tickets.service.ts`
- Modify: `backend/src/tickets/ticket-status.service.spec.ts`
- Modify: `backend/src/tickets/tickets-mutations.spec.ts` (ajustar o novo
  parâmetro do construtor, se esse arquivo instancia `TicketsService`
  diretamente)
- Modify: `backend/src/tickets/tickets.service.spec.ts` (idem)

**Interfaces:**
- Consumes: `SurveysService.createForTicket(tx, ticket)` (Task 2),
  `TicketNotifier.surveyRequested` (Task 5).
- Produces: `TicketsService` com 8º parâmetro de construtor `surveys:
  SurveysService`; `findOne` inclui `satisfactionSurvey`.

- [ ] **Step 1: Escrever o teste falhando**

Em `backend/src/tickets/ticket-status.service.spec.ts`, atualizar
`makeService()` pra aceitar e passar um mock de `surveys`, e adicionar os
casos novos:

```ts
function makeService(current: any, overrides: Record<string, unknown> = {}) {
  const events: any[] = [];
  const tx = {
    ticket: {
      update: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 't1', number: '2026-0001', ...current, ...data }),
      ),
    },
    ticketEvent: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        events.push(data);
        return Promise.resolve(data);
      }),
    },
  };
  const prisma = {
    ticket: { findUnique: vi.fn().mockResolvedValue({ id: 't1', number: '2026-0001', ...current }) },
    $transaction: vi.fn().mockImplementation((cb: any) => cb(tx)),
  };
  const notifier = {
    created: vi.fn(),
    resolved: vi.fn().mockResolvedValue(undefined),
    assigned: vi.fn(),
    surveyRequested: vi.fn().mockResolvedValue(undefined),
  };
  const surveys = { createForTicket: vi.fn().mockResolvedValue(null) };
  const service = new TicketsService(
    prisma as any,
    {} as any,
    {} as any,
    new TicketEventsService(),
    new TicketStatusService(),
    notifier as any,
    { resolveForTicket: vi.fn().mockResolvedValue(null) } as any,
    (overrides.surveys as any) ?? surveys,
  );
  return { service, notifier, events, tx, surveys };
}
```

E adicionar ao final do `describe('TicketsService.changeStatus', ...)`:

```ts
  it('RESOLVED→CLOSED cria a pesquisa e notifica quando há solicitante', async () => {
    const survey = { id: 's1', publicToken: 'tok123' };
    const surveys = { createForTicket: vi.fn().mockResolvedValue(survey) };
    const { service, notifier } = makeService({ status: 'RESOLVED', resolvedAt: new Date() }, { surveys });
    const res = await service.changeStatus('t1', 'CLOSED', { id: 'ag' });
    expect(surveys.createForTicket).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 't1' }));
    expect(notifier.surveyRequested).toHaveBeenCalledWith(res, survey);
  });

  it('RESOLVED→CLOSED não notifica pesquisa quando já existe uma (createForTicket devolve null)', async () => {
    const { service, notifier, surveys } = makeService({ status: 'RESOLVED', resolvedAt: new Date() });
    await service.changeStatus('t1', 'CLOSED', { id: 'ag' });
    expect(surveys.createForTicket).toHaveBeenCalled();
    expect(notifier.surveyRequested).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- ticket-status.service.spec.ts`
Expected: FAIL — `TicketsService` espera 7 argumentos, recebeu 8 (ou
`surveys.createForTicket` nunca é chamado, dependendo de onde o TS
reclamar primeiro).

- [ ] **Step 3: Implementar o hook em `TicketsService`**

Em `backend/src/tickets/tickets.service.ts`, importar `SurveysService`
como **valor** (é usado como tipo de parâmetro de construtor injetado —
nunca `import type` aqui):

```ts
import { SurveysService } from '../surveys/surveys.service.js';
```

Adicionar o 8º parâmetro ao construtor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketNumber: TicketNumberService,
    private readonly sla: SlaService,
    private readonly events: TicketEventsService,
    private readonly statusRules: TicketStatusService,
    @Inject('TicketNotifier') private readonly notifier: TicketNotifier,
    private readonly contracts: ContractsService,
    private readonly surveys: SurveysService,
  ) {}
```

Alterar `changeStatus` pra criar a survey dentro da mesma transação e
notificar depois do commit:

```ts
  async changeStatus(id: string, next: TicketStatus, actor?: Actor): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundException('Chamado não encontrado.');

    this.statusRules.assertTransition(ticket.status, next);

    const data: Prisma.TicketUpdateInput = { status: next };
    if (next === 'RESOLVED') data.resolvedAt = new Date();
    if (next === 'CLOSED') data.closedAt = new Date();
    if (next === 'OPEN' && (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED')) {
      data.resolvedAt = null;
      data.closedAt = null;
    }

    const { updated, survey } = await this.prisma.$transaction(async (tx) => {
      const u = await tx.ticket.update({ where: { id }, data });
      await this.events.record(
        tx,
        id,
        'STATUS_CHANGED',
        { from: ticket.status, to: next },
        actor?.id,
      );
      const survey = next === 'CLOSED' ? await this.surveys.createForTicket(tx, u) : null;
      return { updated: u, survey };
    });

    if (next === 'RESOLVED') await this.notify((n) => n.resolved(updated), updated);
    if (survey) await this.notify((n) => n.surveyRequested(updated, survey), updated);
    return updated;
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- ticket-status.service.spec.ts`
Expected: PASS (todos os testes de `changeStatus`, incluindo os 2 novos).

- [ ] **Step 5: Ajustar outros arquivos que instanciam `TicketsService` direto**

```bash
grep -rn "new TicketsService(" backend/src
```

Pra cada ocorrência fora de `ticket-status.service.spec.ts` (ex.:
`tickets-mutations.spec.ts`, `tickets.service.spec.ts`,
`contracts.integration.spec.ts`, `quotes.integration.spec.ts`), adicionar
um 8º argumento `{ createForTicket: vi.fn().mockResolvedValue(null) } as
any` (unit tests) ou uma instância real de `SurveysService` (specs de
integração, que já importam serviços reais — ver Task 7 pro padrão exato).
Rodar `npm run test` depois de cada ajuste pra confirmar.

- [ ] **Step 6: Incluir `satisfactionSurvey` em `findOne`**

Em `backend/src/tickets/tickets.service.ts`, no `include` de `findOne`
(depois de `attachments: { orderBy: { createdAt: 'asc' } },`):

```ts
        satisfactionSurvey: { select: { score: true, comment: true, respondedAt: true } },
```

- [ ] **Step 7: Rodar toda a suíte unit**

Run: `npm run test`
Expected: PASS, sem regressão em nenhum módulo.

- [ ] **Step 8: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 9: Commit**

```bash
git add backend/src/tickets
git commit -m "feat(surveys): fechar chamado cria a pesquisa e notifica o solicitante"
```

---

## Task 7: Integração (Postgres real) + CHANGELOG parcial

**Files:**
- Create: `backend/src/surveys/surveys.integration.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `TicketsService`, `SurveysService` reais (sem mock).

- [ ] **Step 1: `surveys.integration.spec.ts` — ciclo completo**

`backend/src/surveys/surveys.integration.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SurveysService } from './surveys.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TicketNumberService } from '../tickets/ticket-number.service.js';
import { TicketEventsService } from '../tickets/ticket-events.service.js';
import { TicketStatusService } from '../tickets/ticket-status.service.js';
import { SlaService } from '../sla/sla.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

// Teste de INTEGRAÇÃO: Postgres real. Fechar chamado com solicitante →
// survey criada com token → responder pelo token → respondedAt gravado →
// reabrir e fechar de novo não duplica. Sobe com `docker compose up -d
// postgres`. Sem banco no ar, pula com aviso.
const PFX = `SURV-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticketSatisfactionSurvey.deleteMany({ where: { ticket: { number: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Surveys — ciclo completo ao fechar chamado (Postgres real)', () => {
  let tickets: TicketsService;
  let surveys: SurveysService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[surveys.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const requester = await prisma.user.create({
      data: { email: `contato@${EMAIL_DOMAIN}`, name: `${PFX} Contato`, type: 'CLIENT', role: 'CONTACT', clientId: client.id },
    });
    const ticket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado de teste',
        description: 'x',
        clientId: client.id,
        requesterId: requester.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        origin: 'MANUAL',
        resolvedAt: new Date(),
      },
    });
    id.ticket = ticket.id;

    await prisma.slaPolicy.upsert({
      where: { priority: 'MEDIUM' },
      update: { hours: 24 },
      create: { priority: 'MEDIUM', hours: 24 },
    });

    const prismaService = prisma as unknown as PrismaService;
    surveys = new SurveysService(prismaService);
    const sla = new SlaService(prismaService);
    const events = new TicketEventsService();
    const ticketNumber = new TicketNumberService();
    const statusRules = new TicketStatusService();
    const contracts = new ContractsService(prismaService);
    const notifier = { created: async () => {}, resolved: async () => {}, assigned: async () => {}, publicComment: async () => {}, slaBreached: async () => {}, surveyRequested: async () => {} };
    tickets = new TicketsService(prismaService, ticketNumber, sla, events, statusRules, notifier as any, contracts, surveys);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('fechar o chamado cria a pesquisa; responder grava a nota; reabrir e fechar de novo não duplica', async () => {
    if (!available) return;

    await tickets.changeStatus(id.ticket, 'CLOSED');
    const created = await prisma!.ticketSatisfactionSurvey.findUnique({ where: { ticketId: id.ticket } });
    expect(created).not.toBeNull();

    await surveys.respond(created!.publicToken, { score: 5, comment: 'Muito bom' });
    const responded = await prisma!.ticketSatisfactionSurvey.findUnique({ where: { ticketId: id.ticket } });
    expect(responded!.score).toBe(5);
    expect(responded!.respondedAt).not.toBeNull();

    await tickets.changeStatus(id.ticket, 'OPEN');
    await tickets.changeStatus(id.ticket, 'RESOLVED');
    await tickets.changeStatus(id.ticket, 'CLOSED');
    const count = await prisma!.ticketSatisfactionSurvey.count({ where: { ticketId: id.ticket } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar o teste de integração**

Run (com Postgres no ar): `npm run test:integration -- surveys.integration`
Expected: PASS (ou pulado com aviso se o Postgres não estiver acessível).

- [ ] **Step 3: CHANGELOG parcial**

Em `CHANGELOG.md`, logo abaixo de `## [Não lançado]`:

```markdown
## [Não lançado]

### Adicionado
- **Pesquisa de satisfação (CSAT)** por chamado: ao fechar, gera nota 1–5 +
  comentário opcional via link público sem login pro solicitante; a
  resposta aparece na ficha do chamado.
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/surveys/surveys.integration.spec.ts CHANGELOG.md
git commit -m "test(integration): ciclo completo da pesquisa de satisfação"
```

---

## Task 8: Frontend — `lib/surveys.ts` + página pública `/pesquisa/[token]`

**Files:**
- Create: `frontend/src/lib/surveys.ts`
- Create: `frontend/src/app/pesquisa/[token]/page.tsx`
- Modify: `frontend/src/lib/tickets.ts`

**Interfaces:**
- Consumes: `GET /public/surveys/:token`, `POST /public/surveys/:token`.
- Produces: `TicketDetail.satisfactionSurvey` (tipo).

- [ ] **Step 1: Tipo em `lib/tickets.ts`**

Em `frontend/src/lib/tickets.ts`, no `interface TicketDetail`, adicionar
(depois de `attachments: Attachment[];`):

```ts
  satisfactionSurvey?: { score: number | null; comment: string | null; respondedAt: string | null } | null;
```

- [ ] **Step 2: `lib/surveys.ts`**

`frontend/src/lib/surveys.ts` — só os tipos usados pela página pública
(que não usa `api()`, faz `fetch` direto, sem sessão):

```ts
export interface PublicSurvey {
  ticketNumber: string;
  ticketTitle: string;
  score: number | null;
  comment: string | null;
  respondedAt: string | null;
}
```

- [ ] **Step 3: Página pública**

`frontend/src/app/pesquisa/[token]/page.tsx`:

```tsx
'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PublicSurvey } from '@/lib/surveys';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: survey, isLoading } = useQuery({
    queryKey: ['public-survey', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/surveys/${token}`);
      if (!res.ok) throw new Error('Pesquisa não encontrada.');
      return (await res.json()) as PublicSurvey;
    },
  });

  async function submit() {
    if (!score) return;
    const res = await fetch(`${API_BASE}/public/surveys/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score, comment: comment || undefined }),
    });
    if (res.status === 409) {
      setErrorMsg('Você já respondeu essa pesquisa.');
      return;
    }
    if (!res.ok) {
      setErrorMsg('Não foi possível enviar. Tente novamente.');
      return;
    }
    setSubmitted(true);
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!survey) return <p className="p-6 text-sm text-muted-foreground">Pesquisa não encontrada.</p>;

  const alreadyResponded = submitted || !!survey.respondedAt;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Chamado {survey.ticketNumber}</h1>
      <p className="text-sm text-muted-foreground">{survey.ticketTitle}</p>

      {alreadyResponded ? (
        <p className="text-sm">Obrigado pela resposta!</p>
      ) : (
        <>
          <p className="text-sm">Como você avalia o atendimento?</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-10 w-10 rounded-md border text-sm font-medium ${score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Comentário (opcional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          <Button className="w-fit" disabled={!score} onClick={submit}>
            Enviar
          </Button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Testar no navegador**

Rodar o dev server, fechar um chamado com solicitante conhecido, pegar o
`publicToken` direto no banco (`SELECT "publicToken" FROM
ticket_satisfaction_surveys ORDER BY "sentAt" DESC LIMIT 1;`), abrir
`/pesquisa/<token>`, escolher uma nota, enviar, confirmar mensagem de
obrigado; recarregar a página e confirmar que mostra "Obrigado" (não o
formulário de novo).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/surveys.ts frontend/src/lib/tickets.ts frontend/src/app/pesquisa
git commit -m "feat(frontend): página pública de resposta da pesquisa de satisfação"
```

---

## Task 9: Frontend — bloco "Satisfação" na ficha do chamado

**Files:**
- Create: `frontend/src/components/ticket-satisfaction.tsx`
- Modify: `frontend/src/app/app/chamados/[id]/page.tsx`

**Interfaces:**
- Consumes: `ticket.satisfactionSurvey` (já incluído em `TicketDetail` pela
  Task 8, populado pelo backend na Task 6).

- [ ] **Step 1: Componente**

`frontend/src/components/ticket-satisfaction.tsx`:

```tsx
import type { TicketDetail } from '@/lib/tickets';

export function TicketSatisfaction({ ticket }: { ticket: TicketDetail }) {
  const survey = ticket.satisfactionSurvey;
  if (!survey) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Satisfação</h2>
      {survey.respondedAt ? (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">⭐ {survey.score}/5</p>
          {survey.comment && <p className="mt-1 text-muted-foreground">{survey.comment}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aguardando resposta do cliente.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Registrar na ficha do chamado**

Em `frontend/src/app/app/chamados/[id]/page.tsx`, importar e renderizar
junto dos outros blocos (perto de `TicketQuotes`):

```tsx
import { TicketSatisfaction } from '@/components/ticket-satisfaction';
```

```tsx
          <TicketSatisfaction ticket={ticket} />
```

- [ ] **Step 3: Testar no navegador**

Abrir a ficha de um chamado fechado com pesquisa pendente → ver
"Aguardando resposta do cliente"; responder pelo link público → recarregar
a ficha → ver a nota e o comentário.

- [ ] **Step 4: Build de sanidade do frontend**

Run: `npm run build`
Expected: compila sem erro de tipo, todas as rotas geradas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ticket-satisfaction.tsx "frontend/src/app/app/chamados/[id]/page.tsx"
git commit -m "feat(frontend): bloco de satisfação na ficha do chamado"
```

---

## Task 10: E2E + release 0.7.0 (parte 1/4)

**Files:**
- Create: `frontend/e2e/csat-pos-chamado.spec.ts`
- Modify: `CHANGELOG.md`
- Modify: `backend/package.json`
- Modify: `frontend/package.json`

**Interfaces:** nenhuma nova — usa a UI e o banco ponta a ponta.

- [ ] **Step 1: Escrever o E2E**

`frontend/e2e/csat-pos-chamado.spec.ts` — como o link da pesquisa só sai
por e-mail (sem provedor configurado em dev/E2E) ou direto no banco, o
teste lê o token via Prisma depois de fechar o chamado pela UI, igual ao
padrão já aceito no plano da fase 0.6.0 pra casos assim:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_EMAIL } from './seed-e2e.js';

async function loginAsAdmin(page: Page) {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');
}

test('fechar chamado gera pesquisa; responder pelo link mostra a nota na ficha', async ({ page }) => {
  test.setTimeout(60_000);
  const titulo = `Chamado CSAT E2E ${Date.now()}`;

  await loginAsAdmin(page);

  await page.goto('/app/chamados/novo');
  await page.getByLabel('Cliente').selectOption({ label: 'Cliente E2E' });
  await page.getByLabel('Solicitante').selectOption({ label: /Contato E2E/ });
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Descrição').fill('Descrição de teste E2E.');
  await page.getByRole('button', { name: 'Criar chamado' }).click();
  await page.waitForURL(/\/app\/chamados\/.+/);

  const ticketId = page.url().split('/').pop()!;

  await page.getByLabel('Status').selectOption('RESOLVED');
  await page.getByLabel('Status').selectOption('CLOSED');
  await expect(page.getByText('Aguardando resposta do cliente')).toBeVisible();

  const prisma = new PrismaClient();
  const survey = await prisma.ticketSatisfactionSurvey.findUnique({ where: { ticketId } });
  await prisma.$disconnect();
  expect(survey).not.toBeNull();

  await page.goto(`/pesquisa/${survey!.publicToken}`);
  await page.getByRole('button', { name: '5' }).click();
  await page.getByPlaceholder('Comentário (opcional)').fill('Muito bom atendimento');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText('Obrigado pela resposta!')).toBeVisible();

  await page.goto(`/app/chamados/${ticketId}`);
  await expect(page.getByText('⭐ 5/5')).toBeVisible();
  await expect(page.getByText('Muito bom atendimento')).toBeVisible();
});
```

> Os seletores exatos do form de "novo chamado" (`getByLabel('Cliente')`,
> `getByLabel('Solicitante')` etc.) dependem dos `label`/`htmlFor` reais de
> `frontend/src/app/app/chamados/novo/page.tsx` — leia esse arquivo antes
> de rodar e ajuste os seletores pro que a página realmente expõe (mesmo
> processo usado nos E2E das fases anteriores). O e-mail `E2E_EMAIL`
> (`contato@e2e.test`) já é seedado por `seed-e2e.ts` como contato
> `Contato E2E` do `Cliente E2E`.

- [ ] **Step 2: Rodar o E2E isoladamente**

Run: `npx playwright test csat-pos-chamado`
Expected: PASS (ajustando seletores conforme necessário).

**Nota de ambiente conhecida** (ver ledger da fase 0.6.0): rodar a suíte
E2E completa várias vezes seguidas na mesma janela de 60s pode esgotar o
rate limit de login (10/min compartilhado entre specs) e produzir falha
não relacionada ao código. Reiniciar o backend entre rodadas de
verificação evita esse falso-negativo.

- [ ] **Step 3: Rodar a suíte E2E completa**

Run: `npx playwright test`
Expected: todas as specs (incluindo a nova) passam.

- [ ] **Step 4: Consolidar o CHANGELOG**

Substituir a entrada parcial da Task 7 por:

```markdown
## [Não lançado]

## [0.7.0] - <DATA_DO_RELEASE>

### Adicionado
- **Pesquisa de satisfação (CSAT)** por chamado (fase 0.7.0, parte 1/4):
  ao fechar, gera nota 1–5 + comentário opcional via link público sem
  login pro solicitante; a resposta aparece na ficha do chamado. Uma
  pesquisa por chamado — reabrir e fechar de novo não gera segunda.
```

Substituir `<DATA_DO_RELEASE>` pela data real do dia do release.

- [ ] **Step 5: Bump de versão**

Em `backend/package.json` e `frontend/package.json`, `"version"` de
`0.6.0` para `0.7.0`.

- [ ] **Step 6: Rodar a suíte completa**

Run: `cd backend && npm run test && npm run build`
Run: `cd frontend && npm run build`
Expected: tudo verde, build limpo dos dois lados.

- [ ] **Step 7: Commit e tag**

```bash
git add CHANGELOG.md backend/package.json frontend/package.json frontend/e2e/csat-pos-chamado.spec.ts
git commit -m "chore: release 0.7.0 (parte 1/4) — pesquisa de satisfação pós-chamado"
git tag v0.7.0
```

---

## Notas de execução

- Este plano assume execução direta na `main` em `os-exec` (sem
  worktree), seguindo o padrão já usado nas fases anteriores — confirme
  com o usuário antes de começar.
- A 0.7.0 tem mais 3 partes (Dashboard, SLA real, Base de conhecimento),
  cada uma com seu próprio brainstorm→spec→plano→execução. A tag `v0.7.0`
  desta parte marca só a entrega do CSAT — decida com o usuário se as
  próximas partes reaproveitam a mesma tag/versão (bump só no fechamento
  da fase inteira) ou se cada uma ganha sua própria tag incremental
  (`v0.7.1`, etc.). Este plano assume a primeira opção por default (mesmo
  padrão dos `[Não lançado]` acumulando até o release), mas isso é uma
  decisão a confirmar antes da Task 10.
- Task 6, Step 5 pede uma busca (`grep`) em vez de listar os arquivos
  exatos porque o número de testes que instanciam `TicketsService`
  diretamente pode ter mudado desde a última fase — confie no grep, não
  nesta lista.
