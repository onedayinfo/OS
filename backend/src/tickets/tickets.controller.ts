import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { TicketsService } from './tickets.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { SetTicketAssetsDto } from './dto/set-ticket-assets.dto.js';
import { ListTicketsDto } from './dto/list-tickets.dto.js';
import {
  AssignDto,
  ChangePriorityDto,
  ChangeStatusDto,
  TriageDto,
} from './dto/ticket-mutations.dto.js';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  // Sem @Roles: interno (ADMIN/AGENT) cria manual; CLIENT abre pelo portal.
  // O service ramifica por `actor.type` — no portal, cliente/solicitante/origin
  // vêm do token e os campos correspondentes do body são ignorados.
  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.create(dto, actor);
  }

  // Sem @Roles: qualquer autenticado; o escopo por papel é aplicado no service.
  @Get()
  findAll(@Query() query: ListTicketsDto, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.findAll(query, actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserData) {
    return this.tickets.findOne(id, actor);
  }

  @Patch(':id/status')
  @Roles('ADMIN', 'AGENT')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.tickets.changeStatus(id, dto.status, actor);
  }

  @Patch(':id/assign')
  @Roles('ADMIN', 'AGENT')
  assign(
    @Param('id') id: string,
    @Body() dto: AssignDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.tickets.assign(id, dto.assigneeId ?? null, actor);
  }

  @Patch(':id/priority')
  @Roles('ADMIN', 'AGENT')
  changePriority(
    @Param('id') id: string,
    @Body() dto: ChangePriorityDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.tickets.changePriority(id, dto.priority, actor);
  }

  @Patch(':id/assets')
  @Roles('ADMIN', 'AGENT')
  setAssets(
    @Param('id') id: string,
    @Body() dto: SetTicketAssetsDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.tickets.setTicketAssets(
      id,
      { locationId: dto.locationId ?? null, assetIds: dto.assetIds },
      actor,
    );
  }

  @Patch(':id/triage')
  @Roles('ADMIN', 'AGENT')
  triage(
    @Param('id') id: string,
    @Body() dto: TriageDto,
    @CurrentUser() actor: CurrentUserData,
  ) {
    return this.tickets.triage(id, dto, actor);
  }
}
