import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service.js';
import { AssetsImportService } from './assets-import.service.js';
import { ImprovementsService } from '../agent/improvements.service.js';
import { AssetsController } from './assets.controller.js';

@Module({
  providers: [AssetsService, AssetsImportService, ImprovementsService],
  controllers: [AssetsController],
  exports: [AssetsService, ImprovementsService],
})
export class AssetsModule {}
