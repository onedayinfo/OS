import { Module } from '@nestjs/common';
import { AssetTypesService } from './asset-types.service.js';
import { AssetTypesController } from './asset-types.controller.js';

@Module({
  providers: [AssetTypesService],
  controllers: [AssetTypesController],
  exports: [AssetTypesService],
})
export class AssetTypesModule {}
