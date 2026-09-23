import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { KnowledgeService } from './knowledge.service.js';
import { CreateArticleDto } from './dto/create-article.dto.js';
import { UpdateArticleDto } from './dto/update-article.dto.js';

@Controller('knowledge-articles')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  @Roles('ADMIN', 'AGENT')
  findAll(
    @Query('q') q?: string,
    @Query('categoryId') categoryId?: string,
    @Query('assetTypeId') assetTypeId?: string,
  ) {
    return this.knowledge.findAll({ q, categoryId, assetTypeId });
  }

  @Post()
  @Roles('ADMIN', 'AGENT')
  create(@Body() dto: CreateArticleDto, @CurrentUser() actor: CurrentUserData) {
    return this.knowledge.create(dto, actor);
  }

  // Precisa vir ANTES de `:id` — senão "suggestions" seria lido como um id.
  @Get('suggestions')
  @Roles('ADMIN', 'AGENT')
  suggestions(@Query('ticketId') ticketId: string) {
    return this.knowledge.suggestFor(ticketId);
  }

  @Get(':id')
  @Roles('ADMIN', 'AGENT')
  findOne(@Param('id') id: string) {
    return this.knowledge.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'AGENT')
  update(@Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledge.update(id, dto);
  }
}
