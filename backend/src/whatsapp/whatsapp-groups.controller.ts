import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { WhatsappGroupsService } from './whatsapp-groups.service.js';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto.js';

@Controller('whatsapp/groups')
@Roles('ADMIN', 'AGENT')
export class WhatsappGroupsController {
  constructor(private readonly groups: WhatsappGroupsService) {}

  @Get()
  list(@Query('clientId') clientId?: string) {
    if (!clientId) throw new BadRequestException('clientId é obrigatório.');
    return this.groups.list(clientId);
  }

  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groups.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.groups.remove(id);
  }
}
