import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { WhatsappService } from './whatsapp.service.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';
import { WhatsappGroupsController } from './whatsapp-groups.controller.js';
import { TriggerPhrasesService } from './trigger-phrases.service.js';
import { TriggerPhrasesController } from './trigger-phrases.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [WhatsappWebhookController, WhatsappGroupsController, TriggerPhrasesController],
  providers: [WhatsappService, WhatsappGroupsService, TriggerPhrasesService],
})
export class WhatsappModule {}
