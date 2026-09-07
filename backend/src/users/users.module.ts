import { Module } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { UsersController, ContactsController } from './users.controller.js';
import { LoggerMailSender } from './mail-sender.js';

@Module({
  providers: [UsersService, { provide: 'MailSender', useClass: LoggerMailSender }],
  controllers: [UsersController, ContactsController],
  exports: [UsersService],
})
export class UsersModule {}
