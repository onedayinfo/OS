import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';
import { BackupController } from './backup.controller.js';

@Module({
  providers: [BackupService],
  controllers: [BackupController],
  exports: [BackupService],
})
export class BackupModule {}
