import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { ClientsModule } from '../clients/clients.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { AttachmentsModule } from '../attachments/attachments.module.js';
import { InboundController } from './inbound.controller.js';
import { InboundService } from './inbound.service.js';

@Module({
  imports: [UsersModule, ClientsModule, TicketsModule, AttachmentsModule],
  controllers: [InboundController],
  providers: [InboundService],
})
export class InboundModule {}
