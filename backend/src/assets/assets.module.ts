import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service.js';
import { AssetsImportService } from './assets-import.service.js';
import { AssetsController } from './assets.controller.js';

@Module({
  providers: [AssetsService, AssetsImportService],
  controllers: [AssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
