import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AssetTypesService } from './asset-types.service.js';
import { CreateAssetTypeDto } from './dto/create-asset-type.dto.js';
import { UpdateAssetTypeDto } from './dto/update-asset-type.dto.js';

@Controller('asset-types')
export class AssetTypesController {
  constructor(private readonly assetTypes: AssetTypesService) {}

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateAssetTypeDto) {
    return this.assetTypes.create(dto);
  }

  // Qualquer autenticado interno: forms de ativo e a aba de config precisam listar.
  @Get()
  findAll() {
    return this.assetTypes.findAll();
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAssetTypeDto) {
    return this.assetTypes.update(id, dto);
  }
}
