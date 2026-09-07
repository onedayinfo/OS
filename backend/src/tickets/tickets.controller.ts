import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser, CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { TicketsService } from './tickets.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  @Roles('ADMIN', 'AGENT')
  create(@Body() dto: CreateTicketDto, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.create({ ...dto, origin: 'MANUAL' }, actor);
  }
}
