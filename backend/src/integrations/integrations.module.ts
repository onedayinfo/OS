import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { IntegrationsService } from './integrations.service.js';
import { IntegrationEventsController, IntegrationsController } from './integrations.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [IntegrationEventsController, IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
