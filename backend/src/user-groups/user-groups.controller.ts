import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUserData } from '../common/current-user.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { UserGroupsService } from './user-groups.service.js';
import { UpdateUserGroupDto, UserGroupDto } from './dto/user-group.dto.js';

@Controller('user-groups')
@Roles('ADMIN')
export class UserGroupsController {
  constructor(private readonly groups: UserGroupsService) {}

  /** Só o admin pleno (sem grupo) gerencia grupos. */
  private async assertFullAdmin(user: CurrentUserData) {
    if (!(await this.groups.isFullAdmin(user.id))) {
      throw new ForbiddenException('Sem acesso a esta tela.');
    }
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserData) {
    await this.assertFullAdmin(user);
    return this.groups.findAll();
  }

  @Post()
  async create(@CurrentUser() user: CurrentUserData, @Body() dto: UserGroupDto) {
    await this.assertFullAdmin(user);
    return this.groups.create(dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: UpdateUserGroupDto,
  ) {
    await this.assertFullAdmin(user);
    return this.groups.update(id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    await this.assertFullAdmin(user);
    await this.groups.remove(id);
    return { ok: true };
  }
}
