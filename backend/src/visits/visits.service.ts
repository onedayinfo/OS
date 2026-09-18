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
import { GeoDto } from './dto/geo.dto.js';
import { LaborDto } from './dto/labor.dto.js';
import { SetChecklistDto } from './dto/set-checklist.dto.js';

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
