import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { SuggestionsService } from './suggestions.service.js';
import { AcceptSuggestionDto } from './dto/suggestion.dto.js';

@Controller('whatsapp/suggestions')
@Roles('ADMIN', 'AGENT')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.suggestions.list(status);
  }

  @Post(':id/accept')
  accept(@Param('id') id: string, @Body() dto: AcceptSuggestionDto, @CurrentUser() actor: CurrentUserData) {
    return this.suggestions.accept(id, actor.id, dto);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @CurrentUser() actor: CurrentUserData) {
    return this.suggestions.discard(id, actor.id);
  }
}
