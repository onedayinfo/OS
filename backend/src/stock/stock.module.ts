import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { StockController } from './stock.controller.js';
import { TicketMaterialUsagesController } from './ticket-material-usages.controller.js';
import { StockService } from './stock.service.js';

@Module({
  imports: [CatalogModule],
  controllers: [StockController, TicketMaterialUsagesController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
