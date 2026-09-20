import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { QuotesService } from './quotes.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { UpdateQuoteDto } from './dto/update-quote.dto.js';
import { ListQuotesDto } from './dto/list-quotes.dto.js';

@Controller('quotes')
@Roles('ADMIN', 'AGENT')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  findAll(@Query() query: ListQuotesDto) {
    return this.quotes.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.quotes.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateQuoteDto, @CurrentUser() actor: CurrentUserData) {
    return this.quotes.create(dto, actor.id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotes.update(id, dto);
  }

  @Post(':id/send')
  send(@Param('id') id: string) {
    return this.quotes.send(id);
  }

  @Post(':id/revise')
  revise(@Param('id') id: string) {
    return this.quotes.revise(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.quotes.remove(id);
  }
}
