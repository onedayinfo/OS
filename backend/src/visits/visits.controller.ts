import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { VisitsService } from './visits.service.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { UpdateVisitDto } from './dto/update-visit.dto.js';
import { ListVisitsDto } from './dto/list-visits.dto.js';

@Controller('visits')
@Roles('ADMIN', 'AGENT')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  findAll(@Query() query: ListVisitsDto, @CurrentUser() actor: CurrentUserData) {
    const technicianId = query.technicianId === 'me' ? actor.id : query.technicianId;
    return this.visits.findAll({ ...query, technicianId });
  }

  @Post()
  create(@Body() dto: CreateVisitDto) {
    return this.visits.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.visits.findOne(id);
  }

  @Patch(':id')
  reschedule(@Param('id') id: string, @Body() dto: UpdateVisitDto) {
    return this.visits.reschedule(id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.visits.cancel(id);
  }
}
