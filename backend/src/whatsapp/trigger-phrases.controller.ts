import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { TriggerPhrasesService } from './trigger-phrases.service.js';
import { ApplyDefaultsDto, CreatePhraseDto, UpdatePhraseDto } from './dto/phrase.dto.js';

@Controller('whatsapp/phrases')
@Roles('ADMIN', 'AGENT')
export class TriggerPhrasesController {
  constructor(private readonly phrases: TriggerPhrasesService) {}

  @Get()
  list(@Query('clientId') clientId?: string) {
    return this.phrases.list(clientId || null);
  }

  @Post()
  create(@Body() dto: CreatePhraseDto) {
    return this.phrases.create(dto);
  }

  @Post('apply-defaults')
  applyDefaults(@Body() dto: ApplyDefaultsDto) {
    return this.phrases.applyDefaults(dto.clientId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePhraseDto) {
    return this.phrases.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.phrases.remove(id);
  }
}
