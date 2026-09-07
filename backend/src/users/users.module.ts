import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController, ContactsController } from './users.controller.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [EmailModule],
  providers: [UsersService],
  controllers: [UsersController, ContactsController],
  exports: [UsersService],
})
export class UsersModule {}
