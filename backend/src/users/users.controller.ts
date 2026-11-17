import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserData } from '../common/current-user.decorator.js';
import { Screen } from '../common/screen.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { UsersService } from './users.service.js';
import { CreateInternalDto } from './dto/create-internal.dto.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Controller('users')
@Roles('ADMIN', 'AGENT')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('internal')
  @Screen('config')
  @Roles('ADMIN')
  createInternal(@Body() dto: CreateInternalDto, @CurrentUser() actor: CurrentUserData) {
    return this.users.createInternal(dto, actor);
  }

  @Get()
  findAll(@Query('type') type?: string, @Query('clientId') clientId?: string) {
    return this.users.findAll({ type, clientId });
  }

  @Patch(':id')
  @Screen('config')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: CurrentUserData) {
    return this.users.update(id, dto, actor);
  }
}

@Controller('clients/:clientId/contacts')
@Roles('ADMIN', 'AGENT')
export class ContactsController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Param('clientId') clientId: string, @Body() dto: CreateContactDto) {
    return this.users.createContact(clientId, dto);
  }

  @Get()
  findAll(@Param('clientId') clientId: string) {
    return this.users.findAll({ type: 'CLIENT', clientId });
  }
}
