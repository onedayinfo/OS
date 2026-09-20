import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto.js';
import { ListCatalogItemsDto } from './dto/list-catalog-items.dto.js';

@Controller('catalog-items')
@Roles('ADMIN', 'AGENT')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  findAll(@Query() query: ListCatalogItemsDto) {
    return this.catalog.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateCatalogItemDto) {
    return this.catalog.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateCatalogItemDto) {
    return this.catalog.update(id, dto);
  }
}
