import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import { CreateChecklistTemplateDto } from './dto/create-checklist-template.dto.js';
import { UpdateChecklistTemplateDto } from './dto/update-checklist-template.dto.js';

@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly templates: ChecklistTemplatesService) {}

  @Get()
  @Roles('ADMIN', 'AGENT')
  findAll(@Query('categoryId') categoryId?: string) {
    return this.templates.findAll(categoryId);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateChecklistTemplateDto) {
    return this.templates.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateChecklistTemplateDto) {
    return this.templates.update(id, dto);
  }
}
