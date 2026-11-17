import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController, ContactsController } from './users.controller.js';
import { EmailModule } from '../email/email.module.js';
import { UserGroupsModule } from '../user-groups/user-groups.module.js';

@Module({
  imports: [EmailModule, UserGroupsModule],
  providers: [UsersService],
  controllers: [UsersController, ContactsController],
  exports: [UsersService],
})
export class UsersModule {}
