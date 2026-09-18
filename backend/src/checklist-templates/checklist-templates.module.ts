import { Module } from '@nestjs/common';
import { ChecklistTemplatesService } from './checklist-templates.service.js';
import { ChecklistTemplatesController } from './checklist-templates.controller.js';

@Module({
  providers: [ChecklistTemplatesService],
  controllers: [ChecklistTemplatesController],
  exports: [ChecklistTemplatesService],
})
export class ChecklistTemplatesModule {}
