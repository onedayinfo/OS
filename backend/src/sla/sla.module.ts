import { Module } from '@nestjs/common';
import { SlaService } from './sla.service.js';
import { SlaController } from './sla.controller.js';

@Module({
  providers: [SlaService],
  controllers: [SlaController],
  exports: [SlaService],
})
export class SlaModule {}
