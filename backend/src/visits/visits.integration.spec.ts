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
  const sentEmails: { to: string; subject: string }[] = [];

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

    // A assinatura de teste é um PNG real gravado direto via storage.put —
    // `VisitReportService.generate` precisa ler um arquivo de imagem válido.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await storage.put(`attachments/${PFX}-assinatura.png`, png, 'image/png');
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

    const items = created.checklistTemplate!.items as { id: string }[];
    await visits.setChecklist(created.id, {
      answers: items.map((i) => ({ itemId: i.id, done: true })),
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
});
