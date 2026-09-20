import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesPublicController } from './quotes-public.controller.js';
import { QuotesService } from './quotes.service.js';
import { QuoteNumberService } from './quote-number.service.js';

@Module({
  imports: [CatalogModule, TicketsModule],
  controllers: [QuotesController, QuotesPublicController],
  providers: [QuotesService, QuoteNumberService],
  exports: [QuotesService],
})
export class QuotesModule {}
