import { Module } from '@nestjs/common';
import { UserGroupsModule } from '../user-groups/user-groups.module.js';
import { BackupService } from './backup.service.js';
import { BackupController } from './backup.controller.js';

@Module({
  imports: [UserGroupsModule],
  providers: [BackupService],
  controllers: [BackupController],
  exports: [BackupService],
})
export class BackupModule {}
