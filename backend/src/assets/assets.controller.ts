import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AssetsService } from './assets.service.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

@Controller('assets')
@Roles('ADMIN', 'AGENT')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.assets.create(dto);
  }

  @Get()
  findAll(@Query() query: ListAssetsDto) {
    return this.assets.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assets.findOne(id);
  }

  @Get(':id/credentials')
  reveal(@Param('id') id: string) {
    return this.assets.revealCredentials(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(id, dto);
  }
}
