import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { AttachmentsService } from './attachments.service.js';
import { AttachmentsController } from './attachments.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
