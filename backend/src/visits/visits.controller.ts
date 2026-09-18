import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { VisitsService } from './visits.service.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { UpdateVisitDto } from './dto/update-visit.dto.js';
import { ListVisitsDto } from './dto/list-visits.dto.js';
import { GeoDto } from './dto/geo.dto.js';
import { LaborDto } from './dto/labor.dto.js';
import { SetChecklistDto } from './dto/set-checklist.dto.js';

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

  @Post(':id/check-in')
  checkIn(@Param('id') id: string, @Body() dto: GeoDto) {
    return this.visits.checkIn(id, dto);
  }

  @Post(':id/check-out')
  checkOut(@Param('id') id: string, @Body() dto: GeoDto) {
    return this.visits.checkOut(id, dto);
  }

  @Patch(':id/labor')
  setLabor(@Param('id') id: string, @Body() dto: LaborDto) {
    return this.visits.setLabor(id, dto);
  }

  @Put(':id/checklist')
  setChecklist(@Param('id') id: string, @Body() dto: SetChecklistDto) {
    return this.visits.setChecklist(id, dto);
  }

  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.visits.close(id);
  }

  @Post(':id/report/resend')
  resendReport(@Param('id') id: string) {
    return this.visits.resendReport(id);
  }
}
