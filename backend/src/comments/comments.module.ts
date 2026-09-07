import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module.js';
import { CommentsService } from './comments.service.js';
import { CommentsController } from './comments.controller.js';

@Module({
  imports: [TicketsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
