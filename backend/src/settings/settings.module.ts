import { Global, Module } from '@nestjs/common';
import { UserGroupsModule } from '../user-groups/user-groups.module.js';
import { SettingsService } from './settings.service.js';
import { SettingsController } from './settings.controller.js';

@Global()
@Module({
  imports: [UserGroupsModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
