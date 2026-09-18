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
