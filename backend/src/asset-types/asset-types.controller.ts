import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { Screen, SkipScreen } from '../common/screen.decorator.js';
import { AssetTypesService } from './asset-types.service.js';
import { CreateAssetTypeDto } from './dto/create-asset-type.dto.js';
import { UpdateAssetTypeDto } from './dto/update-asset-type.dto.js';

@Screen('config')
@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly assetTypes: AssetTypesService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateAssetTypeDto) {
    return this.assetTypes.create(dto);
  }

  // Só interno ADMIN/AGENT: forms de ativo e a aba de config (spec §3.2).
  @SkipScreen()
  @Get()
  @Roles('ADMIN', 'AGENT')
  findAll() {
    return this.assetTypes.findAll();
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAssetTypeDto) {
    return this.assetTypes.update(id, dto);
  }
}
