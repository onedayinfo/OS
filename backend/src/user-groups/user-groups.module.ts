import { Module } from '@nestjs/common';
import { UserGroupsService } from './user-groups.service.js';
import { UserGroupsController } from './user-groups.controller.js';

@Module({
  providers: [UserGroupsService],
  controllers: [UserGroupsController],
  exports: [UserGroupsService],
})
export class UserGroupsModule {}
