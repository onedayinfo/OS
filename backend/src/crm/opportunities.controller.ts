import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { OpportunitiesService } from './opportunities.service.js';
import { CreateOpportunityDto } from './dto/create-opportunity.dto.js';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto.js';
import { ListOpportunitiesDto } from './dto/list-opportunities.dto.js';
import { ChangeStageDto } from './dto/change-stage.dto.js';
import { CreateNoteDto } from './dto/create-note.dto.js';

@Controller('opportunities')
@Roles('ADMIN', 'AGENT')
export class OpportunitiesController {
  constructor(private readonly opportunities: OpportunitiesService) {}

  // Precisa vir antes de `:id` — senão o Nest casa "follow-ups" com o param.
  @Get('follow-ups')
  followUps(@Query('scope') scope: 'today' | 'overdue' = 'overdue') {
    return this.opportunities.followUps(scope);
  }

  @Get()
  findAll(@Query() query: ListOpportunitiesDto) {
    return this.opportunities.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.opportunities.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateOpportunityDto) {
    return this.opportunities.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOpportunityDto) {
    return this.opportunities.update(id, dto);
  }

  @Patch(':id/stage')
  changeStage(@Param('id') id: string, @Body() dto: ChangeStageDto) {
    return this.opportunities.changeStage(id, dto);
  }

  @Post(':id/notes')
  addNote(@Param('id') id: string, @Body() dto: CreateNoteDto, @CurrentUser() actor: CurrentUserData) {
    return this.opportunities.addNote(id, dto, actor.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.opportunities.remove(id);
  }
}
