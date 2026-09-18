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
