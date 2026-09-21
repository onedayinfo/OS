# Dashboard de gestão (Fase 0.7.0 — parte 2/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um endpoint só (`GET /dashboard/overview`) devolvendo as métricas de gestão do mês civil corrente — chamados abertos/vencidos, recorrente vs avulso, tempo médio de atendimento, produtividade por técnico, contratos com franquia estourada e margem por chamado avulso — mais uma página `/app/dashboard` que mostra tudo isso.

**Architecture:** Módulo `dashboard` novo, só leitura/agregação — sem model novo, sem migração. Cada bloco de métrica é um método público independente em `DashboardService`, testável isoladamente com datas fixas; `overview()` calcula os limites do mês corrente uma vez e chama os 5 métodos em paralelo. Reaproveita `ContractsService.findAll` (já embute `consumption` por contrato) pro bloco de franquia estourada.

**Tech Stack:** NestJS (ESM, imports relativos terminam em `.js`) + Prisma 6 + PostgreSQL; Next.js 14 App Router + React Query; Vitest (unit com Prisma mockado; `*.integration.spec.ts` com Postgres real); Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-09-21-dashboard-gestao-design.md`

## Global Constraints

- ESM em todo o backend: imports relativos sempre terminam em `.js`.
- Limites de mês sempre em UTC, mesmo padrão já usado em
  `ContractsService.consumption`: `monthStart = Date.UTC(ano, mês, 1)`,
  `monthEnd = Date.UTC(ano, mês+1, 1)`, e todo filtro de data usa
  `{ gte: monthStart, lt: monthEnd }` (`lt`, não `lte` — `monthEnd` é o
  primeiro instante do mês seguinte).
- Cada bloco de métrica de `DashboardService` é um método público
  independente que recebe `monthStart`/`monthEnd` como parâmetros
  explícitos (quando aplicável) — nunca calcula a data internamente. Isso
  permite testar cada bloco com datas fixas, sem mockar o relógio do
  sistema.
- Rota `GET /dashboard/overview` usa `@Roles('ADMIN', 'AGENT')`, mesmo
  padrão de `ContractsController`/`CatalogController`/`QuotesController`.
- Sem migração, sem DTO de entrada (o endpoint não recebe parâmetros).
- Valores monetários arredondados pra 2 casas decimais antes de sair no
  payload (`Math.round(x * 100) / 100`), mesmo padrão já usado em
  `ContractsService.consumption` pro cálculo de horas.
- **Ainda sem tag/release**: esta é a parte 2/4 da fase 0.7.0. Sem bump de
  versão em `package.json`, sem `git tag` — mesma decisão já tomada na
  parte 1/4 (CSAT). CHANGELOG fica em `[Não lançado]`.

---

## Task 1: `DashboardService` — bloco `tickets`

**Files:**
- Create: `backend/src/dashboard/dashboard.service.ts`
- Create: `backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Produces: `DashboardService.ticketsBlock(monthStart: Date, monthEnd: Date): Promise<{ open: number; overdue: number; recurring: number; standalone: number }>`.

- [ ] **Step 1: Escrever o teste falhando**

`backend/src/dashboard/dashboard.service.spec.ts`:

```ts
import { DashboardService } from './dashboard.service.js';

const MONTH_START = new Date('2026-09-01T00:00:00.000Z');
const MONTH_END = new Date('2026-10-01T00:00:00.000Z');

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    ticket: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    visit: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    quote: { findMany: vi.fn().mockResolvedValue([]) },
    ticketMaterialUsage: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('DashboardService.ticketsBlock', () => {
  it('conta open/overdue/recurring/standalone com as queries certas', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi
          .fn()
          .mockResolvedValueOnce(5) // open
          .mockResolvedValueOnce(2) // overdue
          .mockResolvedValueOnce(3) // recurring
          .mockResolvedValueOnce(7), // standalone
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.ticketsBlock(MONTH_START, MONTH_END);

    expect(result).toEqual({ open: 5, overdue: 2, recurring: 3, standalone: 7 });

    const calls = prisma.ticket.count.mock.calls;
    // open: status fora dos terminais, sem filtro de data
    expect(calls[0][0]).toEqual({ where: { status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] } } });
    // overdue: idem + slaDueAt vencido
    expect(calls[1][0].where.status).toEqual({ notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] });
    expect(calls[1][0].where.slaDueAt).toEqual({ lt: expect.any(Date) });
    // recorrente: criado no mês, contractId preenchido
    expect(calls[2][0]).toEqual({
      where: { createdAt: { gte: MONTH_START, lt: MONTH_END }, contractId: { not: null } },
    });
    // avulso: criado no mês, sem contractId
    expect(calls[3][0]).toEqual({
      where: { createdAt: { gte: MONTH_START, lt: MONTH_END }, contractId: null },
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts` (em `backend/`)
Expected: FAIL — `Cannot find module './dashboard.service.js'`.

- [ ] **Step 3: Implementar**

`backend/src/dashboard/dashboard.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

const TERMINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED'];

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
  ) {}

  async ticketsBlock(monthStart: Date, monthEnd: Date) {
    const [open, overdue, recurring, standalone] = await Promise.all([
      this.prisma.ticket.count({ where: { status: { notIn: TERMINAL_STATUSES } } }),
      this.prisma.ticket.count({
        where: { status: { notIn: TERMINAL_STATUSES }, slaDueAt: { lt: new Date() } },
      }),
      this.prisma.ticket.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd }, contractId: { not: null } },
      }),
      this.prisma.ticket.count({
        where: { createdAt: { gte: monthStart, lt: monthEnd }, contractId: null },
      }),
    ]);
    return { open, overdue, recurring, standalone };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (1 teste).

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard
git commit -m "feat(dashboard): bloco de contagem de chamados (abertos/vencidos/recorrente/avulso)"
```

---

## Task 2: `DashboardService.avgResolutionHours`

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Produces: `DashboardService.avgResolutionHours(monthStart: Date, monthEnd: Date): Promise<number | null>`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.avgResolutionHours', () => {
  it('devolve null se nenhum chamado foi resolvido no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.avgResolutionHours(MONTH_START, MONTH_END);
    expect(result).toBeNull();
    expect(prisma.ticket.findMany).toHaveBeenCalledWith({
      where: { resolvedAt: { gte: MONTH_START, lt: MONTH_END } },
      select: { createdAt: true, resolvedAt: true },
    });
  });

  it('calcula a média em horas de resolvedAt - createdAt', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { createdAt: new Date('2026-09-01T00:00:00Z'), resolvedAt: new Date('2026-09-01T10:00:00Z') }, // 10h
          { createdAt: new Date('2026-09-02T00:00:00Z'), resolvedAt: new Date('2026-09-02T02:00:00Z') }, // 2h
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.avgResolutionHours(MONTH_START, MONTH_END);
    expect(result).toBe(6); // (10+2)/2
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: FAIL — `service.avgResolutionHours is not a function`.

- [ ] **Step 3: Implementar**

Adicionar a `backend/src/dashboard/dashboard.service.ts`:

```ts
  async avgResolutionHours(monthStart: Date, monthEnd: Date): Promise<number | null> {
    const resolved = await this.prisma.ticket.findMany({
      where: { resolvedAt: { gte: monthStart, lt: monthEnd } },
      select: { createdAt: true, resolvedAt: true },
    });
    if (resolved.length === 0) return null;
    const totalHours = resolved.reduce(
      (sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()) / 3_600_000,
      0,
    );
    return Math.round((totalHours / resolved.length) * 100) / 100;
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (3 testes no total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard
git commit -m "feat(dashboard): tempo médio de atendimento do mês"
```

---

## Task 3: `DashboardService.technicianProductivity`

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Produces: `DashboardService.technicianProductivity(monthStart: Date, monthEnd: Date): Promise<Array<{ technicianId: string; name: string; ticketsResolved: number; hoursWorked: number }>>`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.technicianProductivity', () => {
  it('devolve lista vazia sem chamados resolvidos nem visitas no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.technicianProductivity(MONTH_START, MONTH_END);
    expect(result).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('mescla chamados resolvidos e horas trabalhadas por técnico', async () => {
    const prisma = makePrisma({
      ticket: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { assigneeId: 'tec1' },
          { assigneeId: 'tec1' },
          { assigneeId: 'tec2' },
        ]),
      },
      visit: {
        findMany: vi.fn().mockResolvedValue([
          {
            technicianId: 'tec1',
            laborStartAt: new Date('2026-09-05T08:00:00Z'),
            laborEndAt: new Date('2026-09-05T12:00:00Z'), // 4h
          },
          {
            technicianId: 'tec3', // sem chamado resolvido, só visita
            laborStartAt: new Date('2026-09-06T08:00:00Z'),
            laborEndAt: new Date('2026-09-06T09:30:00Z'), // 1.5h
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'tec1', name: 'Técnico Um' },
          { id: 'tec2', name: 'Técnico Dois' },
          { id: 'tec3', name: 'Técnico Três' },
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.technicianProductivity(MONTH_START, MONTH_END);

    expect(result).toEqual(
      expect.arrayContaining([
        { technicianId: 'tec1', name: 'Técnico Um', ticketsResolved: 2, hoursWorked: 4 },
        { technicianId: 'tec2', name: 'Técnico Dois', ticketsResolved: 1, hoursWorked: 0 },
        { technicianId: 'tec3', name: 'Técnico Três', ticketsResolved: 0, hoursWorked: 1.5 },
      ]),
    );
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: FAIL — `service.technicianProductivity is not a function`.

- [ ] **Step 3: Implementar**

Adicionar a `backend/src/dashboard/dashboard.service.ts`:

```ts
  async technicianProductivity(monthStart: Date, monthEnd: Date) {
    const [resolvedTickets, visits] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { resolvedAt: { gte: monthStart, lt: monthEnd }, assigneeId: { not: null } },
        select: { assigneeId: true },
      }),
      this.prisma.visit.findMany({
        where: {
          laborStartAt: { gte: monthStart, lt: monthEnd },
          laborEndAt: { not: null },
        },
        select: { technicianId: true, laborStartAt: true, laborEndAt: true },
      }),
    ]);

    const byTech = new Map<string, { ticketsResolved: number; hoursWorked: number }>();
    for (const t of resolvedTickets) {
      const id = t.assigneeId!;
      const entry = byTech.get(id) ?? { ticketsResolved: 0, hoursWorked: 0 };
      entry.ticketsResolved += 1;
      byTech.set(id, entry);
    }
    for (const v of visits) {
      const hours = (v.laborEndAt!.getTime() - v.laborStartAt!.getTime()) / 3_600_000;
      const entry = byTech.get(v.technicianId) ?? { ticketsResolved: 0, hoursWorked: 0 };
      entry.hoursWorked += hours;
      byTech.set(v.technicianId, entry);
    }

    const ids = [...byTech.keys()];
    if (ids.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    return ids.map((id) => ({
      technicianId: id,
      name: nameById.get(id) ?? '—',
      ticketsResolved: byTech.get(id)!.ticketsResolved,
      hoursWorked: Math.round(byTech.get(id)!.hoursWorked * 100) / 100,
    }));
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (5 testes no total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard
git commit -m "feat(dashboard): produtividade por técnico (chamados resolvidos + horas)"
```

---

## Task 4: `DashboardService.contractsExceeded`

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Consumes: `ContractsService.findAll(filter: { status?: string }): Promise<Array<Contract & { client: { id, name }; consumption: { unit, used, franchiseAmount, exceeded } }>>` (já existe, fase 0.5.0).
- Produces: `DashboardService.contractsExceeded(): Promise<Array<{ contractId: string; name: string; clientName: string; unit: 'VISITS' | 'HOURS'; used: number; franchiseAmount: number }>>`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.contractsExceeded', () => {
  it('filtra só os contratos com consumption.exceeded=true e projeta os campos certos', async () => {
    const contractsService = {
      findAll: vi.fn().mockResolvedValue([
        {
          id: 'c1',
          name: 'Contrato A',
          client: { id: 'cli1', name: 'Cliente A' },
          consumption: { unit: 'VISITS', used: 5, franchiseAmount: 4, exceeded: true },
        },
        {
          id: 'c2',
          name: 'Contrato B',
          client: { id: 'cli2', name: 'Cliente B' },
          consumption: { unit: 'HOURS', used: 3, franchiseAmount: 10, exceeded: false },
        },
      ]),
    };
    const service = new DashboardService({} as any, contractsService as any);
    const result = await service.contractsExceeded();

    expect(contractsService.findAll).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(result).toEqual([
      { contractId: 'c1', name: 'Contrato A', clientName: 'Cliente A', unit: 'VISITS', used: 5, franchiseAmount: 4 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: FAIL — `service.contractsExceeded is not a function`.

- [ ] **Step 3: Implementar**

Adicionar a `backend/src/dashboard/dashboard.service.ts`:

```ts
  async contractsExceeded() {
    const contracts = await this.contracts.findAll({ status: 'ACTIVE' });
    return contracts
      .filter((c) => c.consumption.exceeded)
      .map((c) => ({
        contractId: c.id,
        name: c.name,
        clientName: c.client.name,
        unit: c.consumption.unit,
        used: c.consumption.used,
        franchiseAmount: c.consumption.franchiseAmount,
      }));
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (6 testes no total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard
git commit -m "feat(dashboard): contratos com franquia estourada no mês"
```

---

## Task 5: `DashboardService.margin`

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.spec.ts`

**Interfaces:**
- Produces: `DashboardService.margin(monthStart: Date, monthEnd: Date): Promise<{ ticketsCount: number; totalRevenue: number; totalMaterialCost: number; totalMargin: number; avgMarginPerTicket: number | null }>`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.margin', () => {
  it('devolve tudo zerado sem orçamento aprovado no mês', async () => {
    const prisma = makePrisma();
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);
    expect(result).toEqual({
      ticketsCount: 0,
      totalRevenue: 0,
      totalMaterialCost: 0,
      totalMargin: 0,
      avgMarginPerTicket: null,
    });
    expect(prisma.ticketMaterialUsage.findMany).not.toHaveBeenCalled();
  });

  it('soma receita dos itens do orçamento e cruza com o custo de material do chamado', async () => {
    const prisma = makePrisma({
      quote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'q1', ticketId: 't1', items: [{ quantity: 2, unitPrice: 100 }] }, // receita 200
          { id: 'q2', ticketId: 't2', items: [{ quantity: 1, unitPrice: 500 }] }, // receita 500
        ]),
      },
      ticketMaterialUsage: {
        findMany: vi.fn().mockResolvedValue([
          { ticketId: 't1', quantity: 3, unitCost: 10 }, // custo 30 pro t1
          { ticketId: 't2', quantity: 2, unitCost: 50 }, // custo 100 pro t2
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);

    expect(prisma.quote.findMany).toHaveBeenCalledWith({
      where: { status: 'APPROVED', approvedAt: { gte: MONTH_START, lt: MONTH_END } },
      include: { items: true },
    });
    expect(prisma.ticketMaterialUsage.findMany).toHaveBeenCalledWith({
      where: { ticketId: { in: ['t1', 't2'] } },
    });
    expect(result).toEqual({
      ticketsCount: 2,
      totalRevenue: 700, // 200 + 500
      totalMaterialCost: 130, // 30 + 100
      totalMargin: 570,
      avgMarginPerTicket: 285,
    });
  });

  it('chamado com orçamento aprovado mas sem material usado conta custo 0', async () => {
    const prisma = makePrisma({
      quote: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'q1', ticketId: 't1', items: [{ quantity: 1, unitPrice: 300 }] },
        ]),
      },
    });
    const service = new DashboardService(prisma as any, {} as any);
    const result = await service.margin(MONTH_START, MONTH_END);
    expect(result).toEqual({
      ticketsCount: 1,
      totalRevenue: 300,
      totalMaterialCost: 0,
      totalMargin: 300,
      avgMarginPerTicket: 300,
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: FAIL — `service.margin is not a function`.

- [ ] **Step 3: Implementar**

Adicionar a `backend/src/dashboard/dashboard.service.ts`:

```ts
  async margin(monthStart: Date, monthEnd: Date) {
    const quotes = await this.prisma.quote.findMany({
      where: { status: 'APPROVED', approvedAt: { gte: monthStart, lt: monthEnd } },
      include: { items: true },
    });
    if (quotes.length === 0) {
      return { ticketsCount: 0, totalRevenue: 0, totalMaterialCost: 0, totalMargin: 0, avgMarginPerTicket: null };
    }

    const ticketIds = quotes.map((q) => q.ticketId).filter((id): id is string => !!id);
    const usages = ticketIds.length
      ? await this.prisma.ticketMaterialUsage.findMany({ where: { ticketId: { in: ticketIds } } })
      : [];
    const costByTicket = new Map<string, number>();
    for (const u of usages) {
      costByTicket.set(u.ticketId, (costByTicket.get(u.ticketId) ?? 0) + u.quantity * u.unitCost);
    }

    let totalRevenue = 0;
    let totalMaterialCost = 0;
    for (const q of quotes) {
      totalRevenue += q.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      totalMaterialCost += q.ticketId ? (costByTicket.get(q.ticketId) ?? 0) : 0;
    }

    const ticketsCount = quotes.length;
    const totalMargin = totalRevenue - totalMaterialCost;
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      ticketsCount,
      totalRevenue: round2(totalRevenue),
      totalMaterialCost: round2(totalMaterialCost),
      totalMargin: round2(totalMargin),
      avgMarginPerTicket: round2(totalMargin / ticketsCount),
    };
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (9 testes no total).

- [ ] **Step 5: Commit**

```bash
git add backend/src/dashboard
git commit -m "feat(dashboard): margem por chamado avulso (receita - custo de material)"
```

---

## Task 6: `overview()` + controller + módulo + registro no `app.module.ts`

**Files:**
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.spec.ts`
- Create: `backend/src/dashboard/dashboard.controller.ts`
- Create: `backend/src/dashboard/dashboard.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: os 5 métodos das Tasks 1-5.
- Produces: `DashboardService.overview(): Promise<DashboardOverview>`; rota `GET /dashboard/overview`.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.overview', () => {
  it('calcula os limites do mês corrente e agrega os 5 blocos', async () => {
    const prisma = makePrisma();
    const contractsService = { findAll: vi.fn().mockResolvedValue([]) };
    const service = new DashboardService(prisma as any, contractsService as any);

    const spyTickets = vi.spyOn(service, 'ticketsBlock').mockResolvedValue({ open: 1, overdue: 0, recurring: 0, standalone: 1 });
    const spyAvg = vi.spyOn(service, 'avgResolutionHours').mockResolvedValue(5);
    const spyTech = vi.spyOn(service, 'technicianProductivity').mockResolvedValue([]);
    const spyContracts = vi.spyOn(service, 'contractsExceeded').mockResolvedValue([]);
    const spyMargin = vi.spyOn(service, 'margin').mockResolvedValue({
      ticketsCount: 0, totalRevenue: 0, totalMaterialCost: 0, totalMargin: 0, avgMarginPerTicket: null,
    });

    const result = await service.overview();

    expect(result.tickets).toEqual({ open: 1, overdue: 0, recurring: 0, standalone: 1 });
    expect(result.avgResolutionHours).toBe(5);
    expect(result.technicianProductivity).toEqual([]);
    expect(result.contractsExceeded).toEqual([]);
    expect(result.margin.ticketsCount).toBe(0);
    expect(result.period.start).toBeTypeOf('string');
    expect(result.period.end).toBeTypeOf('string');

    // os 4 métodos que recebem período foram chamados com os MESMOS limites
    const [start1, end1] = spyTickets.mock.calls[0];
    const [start2, end2] = spyAvg.mock.calls[0];
    const [start3, end3] = spyTech.mock.calls[0];
    const [start4, end4] = spyMargin.mock.calls[0];
    expect(start1).toEqual(start2);
    expect(start1).toEqual(start3);
    expect(start1).toEqual(start4);
    expect(end1).toEqual(end2);
    expect(end1).toEqual(end3);
    expect(end1).toEqual(end4);
    expect(spyContracts).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: FAIL — `service.overview is not a function`.

- [ ] **Step 3: Implementar `overview()`**

Adicionar a `backend/src/dashboard/dashboard.service.ts` (interface exportada
+ método):

```ts
export interface DashboardOverview {
  period: { start: string; end: string };
  tickets: { open: number; overdue: number; recurring: number; standalone: number };
  avgResolutionHours: number | null;
  technicianProductivity: Array<{ technicianId: string; name: string; ticketsResolved: number; hoursWorked: number }>;
  contractsExceeded: Array<{ contractId: string; name: string; clientName: string; unit: 'VISITS' | 'HOURS'; used: number; franchiseAmount: number }>;
  margin: { ticketsCount: number; totalRevenue: number; totalMaterialCost: number; totalMargin: number; avgMarginPerTicket: number | null };
}
```

```ts
  async overview(): Promise<DashboardOverview> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const [tickets, avgResolutionHours, technicianProductivity, contractsExceeded, margin] = await Promise.all([
      this.ticketsBlock(monthStart, monthEnd),
      this.avgResolutionHours(monthStart, monthEnd),
      this.technicianProductivity(monthStart, monthEnd),
      this.contractsExceeded(),
      this.margin(monthStart, monthEnd),
    ]);

    return {
      period: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
      tickets,
      avgResolutionHours,
      technicianProductivity,
      contractsExceeded,
      margin,
    };
  }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm run test -- dashboard.service.spec.ts`
Expected: PASS (10 testes no total).

- [ ] **Step 5: Controller**

`backend/src/dashboard/dashboard.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@Roles('ADMIN', 'AGENT')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }
}
```

- [ ] **Step 6: Módulo**

`backend/src/dashboard/dashboard.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [ContractsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 7: Registrar no `app.module.ts`**

```ts
import { DashboardModule } from './dashboard/dashboard.module.js';
```

```ts
    DashboardModule,
```

- [ ] **Step 8: Build de sanidade**

Run: `npm run build`
Expected: compila sem erro.

- [ ] **Step 9: Rodar toda a suíte unit**

Run: `npm run test`
Expected: PASS, sem regressão.

- [ ] **Step 10: Commit**

```bash
git add backend/src/dashboard backend/src/app.module.ts
git commit -m "feat(dashboard): endpoint GET /dashboard/overview"
```

---

## Task 7: Integração (Postgres real) + CHANGELOG parcial

**Files:**
- Create: `backend/src/dashboard/dashboard.integration.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `DashboardService`, `ContractsService` reais (sem mock).

- [ ] **Step 1: `dashboard.integration.spec.ts` — cenário completo**

`backend/src/dashboard/dashboard.integration.spec.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardService } from './dashboard.service.js';
import { ContractsService } from '../contracts/contracts.service.js';

// Teste de INTEGRAÇÃO: Postgres real. 1 chamado avulso com orçamento
// aprovado + material usado, 1 chamado de contrato, 1 contrato com
// franquia estourada, 1 visita com horas apontadas → overview() confere
// os 5 blocos. Sobe com `docker compose up -d postgres`. Sem banco no ar,
// pula com aviso.
const PFX = `DASH-${Date.now()}`;
const EMAIL_DOMAIN = `${PFX.toLowerCase()}.itest`;

let prisma: PrismaClient | undefined;
let available = false;
const id: Record<string, string> = {};

async function cleanup(p: PrismaClient) {
  await p.ticketMaterialUsage.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.quoteItem.deleteMany({ where: { catalogItem: { name: { startsWith: PFX } } } });
  await p.quote.deleteMany({ where: { title: { startsWith: PFX } } });
  await p.visit.deleteMany({ where: { ticket: { number: { startsWith: PFX } } } });
  await p.ticket.deleteMany({ where: { number: { startsWith: PFX } } });
  await p.contract.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.catalogItem.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.location.deleteMany({ where: { name: { startsWith: PFX } } });
  await p.user.deleteMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } } });
  await p.client.deleteMany({ where: { name: { startsWith: PFX } } });
}

describe('Dashboard — overview com dados reais (Postgres real)', () => {
  let dashboard: DashboardService;

  beforeAll(async () => {
    prisma = new PrismaClient();
    try {
      await prisma.$connect();
      available = true;
    } catch {
      console.warn('[dashboard.integration] Postgres indisponível — pulando.');
      return;
    }
    await cleanup(prisma);

    const client = await prisma.client.create({ data: { name: `${PFX} Cliente` } });
    const location = await prisma.location.create({ data: { clientId: client.id, name: `${PFX} Local` } });
    const technician = await prisma.user.create({
      data: { email: `tec@${EMAIL_DOMAIN}`, name: `${PFX} Técnico`, type: 'INTERNAL', role: 'AGENT' },
    });
    const item = await prisma.catalogItem.create({
      data: { name: `${PFX} Instalação`, type: 'SERVICE', unit: 'un', price: 500 },
    });

    // Contrato ativo com franquia de 1 visita/mês — vamos estourar com 2 chamados.
    const contract = await prisma.contract.create({
      data: {
        clientId: client.id,
        name: `${PFX} Contrato`,
        startDate: new Date('2020-01-01'),
        endDate: new Date('2030-01-01'),
        franchiseUnit: 'VISITS',
        franchiseAmount: 1,
        locations: { connect: [{ id: location.id }] },
      },
    });

    const now = new Date();

    // Chamado avulso, resolvido, com orçamento aprovado + material usado.
    const standaloneTicket = await prisma.ticket.create({
      data: {
        number: `${PFX}-0001`,
        title: 'Chamado avulso',
        description: 'x',
        clientId: client.id,
        assigneeId: technician.id,
        priority: 'MEDIUM',
        status: 'RESOLVED',
        origin: 'MANUAL',
        resolvedAt: now,
      },
    });
    const quote = await prisma.quote.create({
      data: {
        number: 1,
        clientId: client.id,
        ticketId: standaloneTicket.id,
        status: 'APPROVED',
        version: 1,
        publicToken: `${PFX}-token`,
        approvedAt: now,
        createdById: technician.id,
        items: { create: [{ catalogItemId: item.id, quantity: 1, unitPrice: 500 }] },
      },
    });
    await prisma.ticketMaterialUsage.create({
      data: { ticketId: standaloneTicket.id, catalogItemId: item.id, warehouseId: (await prisma.warehouse.create({ data: { name: `${PFX} Depósito` } })).id, quantity: 1, unitCost: 100, createdById: technician.id },
    });

    // 2 chamados de contrato no mês → estoura a franquia de 1.
    for (let i = 0; i < 2; i++) {
      await prisma.ticket.create({
        data: {
          number: `${PFX}-000${i + 2}`,
          title: 'Chamado de contrato',
          description: 'x',
          clientId: client.id,
          contractId: contract.id,
          priority: 'MEDIUM',
          status: 'OPEN',
          origin: 'MANUAL',
        },
      });
    }

    // Visita com horas apontadas pro técnico.
    await prisma.visit.create({
      data: {
        ticketId: standaloneTicket.id,
        technicianId: technician.id,
        status: 'DONE',
        scheduledStart: now,
        scheduledEnd: now,
        laborStartAt: new Date(now.getTime() - 2 * 3_600_000),
        laborEndAt: now,
      },
    });

    id.quoteId = quote.id;

    const prismaService = prisma as unknown as PrismaService;
    const contracts = new ContractsService(prismaService);
    dashboard = new DashboardService(prismaService, contracts);
  });

  afterAll(async () => {
    if (available && prisma) await cleanup(prisma);
    await prisma?.$disconnect();
  });

  it('overview() reflete o cenário criado', async () => {
    if (!available) return;

    const result = await dashboard.overview();

    expect(result.tickets.recurring).toBeGreaterThanOrEqual(2);
    expect(result.tickets.standalone).toBeGreaterThanOrEqual(1);
    expect(result.avgResolutionHours).not.toBeNull();
    expect(result.technicianProductivity.find((t) => t.name === `${PFX} Técnico`)).toMatchObject({
      ticketsResolved: 1,
      hoursWorked: 2,
    });
    expect(result.contractsExceeded.find((c) => c.name === `${PFX} Contrato`)).toMatchObject({
      unit: 'VISITS',
      used: 2,
      franchiseAmount: 1,
    });
    expect(result.margin.ticketsCount).toBeGreaterThanOrEqual(1);
    expect(result.margin.totalRevenue).toBeGreaterThanOrEqual(500);
    expect(result.margin.totalMaterialCost).toBeGreaterThanOrEqual(100);
  });
});
```

> **Nota de execução:** o `PFX` garante isolamento contra outros dados de
> dev já existentes no banco — por isso as asserções usam
> `toBeGreaterThanOrEqual`/`find(...)` em vez de igualdade exata nos
> blocos que agregam TUDO do mês (tickets/contratos podem já existir de
> testes anteriores rodados no mesmo banco de dev).

- [ ] **Step 2: Rodar o teste de integração**

Run (com Postgres no ar): `npm run test:integration -- dashboard.integration`
Expected: PASS (ou pulado com aviso se o Postgres não estiver acessível).

- [ ] **Step 3: CHANGELOG parcial**

Em `CHANGELOG.md`, dentro de `## [Não lançado]` (mesma entrada já aberta
pela parte 1/4 do CSAT — adicionar como novo item da lista, não nova
seção):

```markdown
- **Dashboard de gestão** (`/app/dashboard`): chamados abertos/vencidos,
  recorrente vs avulso, tempo médio de atendimento, produtividade por
  técnico, contratos com franquia estourada e margem por chamado avulso —
  tudo do mês civil corrente.
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/dashboard/dashboard.integration.spec.ts CHANGELOG.md
git commit -m "test(integration): cenário completo do dashboard de gestão"
```

---

## Task 8: Frontend — `lib/dashboard.ts` + página `/app/dashboard`

**Files:**
- Create: `frontend/src/lib/dashboard.ts`
- Create: `frontend/src/app/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `GET /dashboard/overview`.

- [ ] **Step 1: `lib/dashboard.ts`**

`frontend/src/lib/dashboard.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface DashboardOverview {
  period: { start: string; end: string };
  tickets: { open: number; overdue: number; recurring: number; standalone: number };
  avgResolutionHours: number | null;
  technicianProductivity: Array<{
    technicianId: string;
    name: string;
    ticketsResolved: number;
    hoursWorked: number;
  }>;
  contractsExceeded: Array<{
    contractId: string;
    name: string;
    clientName: string;
    unit: 'VISITS' | 'HOURS';
    used: number;
    franchiseAmount: number;
  }>;
  margin: {
    ticketsCount: number;
    totalRevenue: number;
    totalMaterialCost: number;
    totalMargin: number;
    avgMarginPerTicket: number | null;
  };
}

export function useDashboardOverview() {
  return useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => api<DashboardOverview>('/dashboard/overview'),
  });
}
```

- [ ] **Step 2: Página**

`frontend/src/app/app/dashboard/page.tsx`:

```tsx
'use client';

import { useDashboardOverview } from '@/lib/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-xs font-medium uppercase text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-2xl font-semibold">{value}</CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data, isLoading } = useDashboardOverview();

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Chamados abertos" value={String(data.tickets.open)} />
        <KpiCard label="Chamados vencidos" value={String(data.tickets.overdue)} />
        <KpiCard
          label="Tempo médio de atendimento"
          value={data.avgResolutionHours != null ? `${data.avgResolutionHours}h` : '—'}
        />
        <KpiCard label="Margem do mês" value={`R$ ${data.margin.totalMargin.toFixed(2)}`} />
      </div>

      <div className="flex gap-6 text-sm">
        <span>
          Recorrente: <strong>{data.tickets.recurring}</strong>
        </span>
        <span>
          Avulso: <strong>{data.tickets.standalone}</strong>
        </span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Produtividade por técnico</h2>
        {data.technicianProductivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atividade este mês.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.technicianProductivity.map((t) => (
              <li key={t.technicianId} className="flex justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{t.name}</span>
                <span className="text-muted-foreground">
                  {t.ticketsResolved} chamado(s) · {t.hoursWorked}h
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Contratos com franquia estourada</h2>
        {data.contractsExceeded.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contrato excedido este mês.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.contractsExceeded.map((c) => (
              <li key={c.contractId} className="flex justify-between rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm">
                <span>{c.clientName} — {c.name}</span>
                <span>
                  {c.used}/{c.franchiseAmount} {c.unit === 'VISITS' ? 'visitas' : 'horas'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Testar no navegador**

Rodar o dev server, logar como ADMIN, abrir `/app/dashboard`, conferir que
os 4 cards e as duas listas renderizam sem erro (mesmo que vazios num
banco novo).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/dashboard.ts frontend/src/app/app/dashboard
git commit -m "feat(frontend): página do dashboard de gestão"
```

---

## Task 9: Frontend — nav + E2E

**Files:**
- Modify: `frontend/src/components/nav.tsx`
- Create: `frontend/e2e/dashboard-gestao.spec.ts`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Nav**

Em `frontend/src/components/nav.tsx`, dentro de `appLinks`, adicionar
**Dashboard como primeiro item** (antes de `Fila`):

```ts
function appLinks(role: string | undefined) {
  const links = [
    { href: '/app/dashboard', label: 'Dashboard' },
    { href: '/app', label: 'Fila' },
    { href: '/app/agenda', label: 'Agenda' },
  ];
```

- [ ] **Step 2: Escrever o E2E**

`frontend/e2e/dashboard-gestao.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from './seed-e2e.js';

test('dashboard de gestão carrega os cards e as tabelas sem erro', async ({ page }) => {
  await page.goto('/app/login');
  await page.locator('#email').fill(E2E_ADMIN_EMAIL);
  await page.locator('#password').fill(E2E_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/app');

  await page.goto('/app/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Chamados abertos')).toBeVisible();
  await expect(page.getByText('Chamados vencidos')).toBeVisible();
  await expect(page.getByText('Produtividade por técnico')).toBeVisible();
  await expect(page.getByText('Contratos com franquia estourada')).toBeVisible();
});
```

- [ ] **Step 3: Rodar o E2E isoladamente**

Run: `npx playwright test dashboard-gestao`
Expected: PASS.

- [ ] **Step 4: Rodar a suíte E2E completa**

Run: `npx playwright test`
Expected: todas as specs passam (se algo falhar só por rate-limit de
login entre specs — problema de ambiente já documentado na fase 0.6.0/CSAT
— reinicie o backend entre rodadas de verificação).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/nav.tsx frontend/e2e/dashboard-gestao.spec.ts
git commit -m "feat(frontend): nav do dashboard + E2E de fumaça"
```

---

## Task 10: Registro final (sem tag)

**Files:**
- Modify: `CHANGELOG.md` (se precisar de ajuste de redação — normalmente não precisa, a Task 7 já escreveu a entrada final)

**Interfaces:** nenhuma.

- [ ] **Step 1: Rodar a suíte completa**

Run: `cd backend && npm run test && npm run build`
Run: `cd frontend && npm run build`
Expected: tudo verde, build limpo dos dois lados.

- [ ] **Step 2: Confirmar que não há bump de versão nem tag**

Igual à parte 1/4 (CSAT): `backend/package.json` e `frontend/package.json`
continuam na versão atual (sem alteração desta task), **sem** `git tag`.
Isso é intencional — a fase 0.7.0 só fecha quando as 4 partes (CSAT,
Dashboard, SLA real, Base de conhecimento) estiverem prontas.

- [ ] **Step 3: Commit (só se houver ajuste de CHANGELOG; senão, pular)**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog do dashboard de gestão (0.7.0 parte 2/4)"
```

---

## Notas de execução

- Este plano assume execução direta na `main` em `os-exec` (sem
  worktree), seguindo o mesmo padrão das fases/partes anteriores — confirme
  com o usuário antes de começar.
- Task 6, Step 1 usa `vi.spyOn(service, 'ticketsBlock')` etc. pra testar
  `overview()` isoladamente dos blocos já testados nas Tasks 1-5 — isso só
  funciona se os métodos forem definidos como métodos de instância comuns
  (não arrow functions em propriedades de classe); o código das Tasks 1-5
  já segue esse padrão.
- Task 7 depende de `Warehouse`/`CatalogItem`/`TicketMaterialUsage` (fase
  0.6.0) e `Quote`/`QuoteItem` (fase 0.6.0) já existirem no schema — já
  existem, sem migração adicional necessária nesta fase.
