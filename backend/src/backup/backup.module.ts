import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';

@Module({
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
