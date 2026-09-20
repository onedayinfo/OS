import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { StockService } from './stock.service.js';
import { CreateMaterialUsageDto } from './dto/create-material-usage.dto.js';

@Controller('tickets/:ticketId/material-usages')
@Roles('ADMIN', 'AGENT')
export class TicketMaterialUsagesController {
  constructor(private readonly stock: StockService) {}

  @Get()
  list(@Param('ticketId') ticketId: string) {
    return this.stock.listMaterialUsages(ticketId);
  }

  @Post()
  register(@Param('ticketId') ticketId: string, @Body() dto: CreateMaterialUsageDto, @CurrentUser() actor: CurrentUserData) {
    return this.stock.registerMaterialUsage(ticketId, dto, actor.id);
  }
}
