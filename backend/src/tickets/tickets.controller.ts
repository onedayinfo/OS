import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { TicketsService } from './tickets.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { ListTicketsDto } from './dto/list-tickets.dto.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @Roles('ADMIN', 'AGENT')
  create(@Body() dto: CreateTicketDto, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.create({ ...dto, origin: 'MANUAL' }, actor);
  }

  // Sem @Roles: qualquer autenticado; o escopo por papel é aplicado no service.
  @Get()
  findAll(@Query() query: ListTicketsDto, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.findAll(query, actor);
  }
}
