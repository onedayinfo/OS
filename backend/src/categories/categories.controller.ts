import { Body, Controller, ForbiddenException, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CurrentUser } from '../common/current-user.decorator.js';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { UpdateCategoryDto } from './dto/update-category.dto.js';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  /** Qualquer usuário interno autenticado (o `JwtAuthGuard` global já exige o login). */
  @Get()
  findAll(@CurrentUser() user: CurrentUserData) {
    if (user.type !== 'INTERNAL') throw new ForbiddenException();
    return this.categories.findAll();
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }
}
