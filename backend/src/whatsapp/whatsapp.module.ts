import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { WhatsappService } from './whatsapp.service.js';
import { WhatsappWebhookController } from './whatsapp-webhook.controller.js';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';
import { WhatsappGroupsController } from './whatsapp-groups.controller.js';
import { TriggerPhrasesService } from './trigger-phrases.service.js';
import { TriggerPhrasesController } from './trigger-phrases.controller.js';
import { WhatsappStatusController } from './whatsapp-status.controller.js';
import { EvolutionStatusService } from './evolution-status.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { AiClassifierService } from './ai-classifier.service.js';
import { TriageService } from './triage.service.js';
import { WhatsappCron } from './whatsapp.cron.js';
import { SuggestionsService } from './suggestions.service.js';
import { SuggestionsController } from './suggestions.controller.js';
import { WhatsappMessagesController } from './whatsapp-messages.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [WhatsappWebhookController, WhatsappGroupsController, TriggerPhrasesController, WhatsappStatusController, SuggestionsController, WhatsappMessagesController],
  providers: [WhatsappService, WhatsappGroupsService, TriggerPhrasesService, EvolutionStatusService, AiUsageService, AiClassifierService, TriageService, WhatsappCron, SuggestionsService],
})
export class WhatsappModule {}
