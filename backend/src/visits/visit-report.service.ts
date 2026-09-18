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
