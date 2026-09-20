import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { QuotesService } from './quotes.service.js';

@Controller('public/quotes')
@Public()
export class QuotesPublicController {
  constructor(private readonly quotes: QuotesService) {}

  @Get(':token')
  find(@Param('token') token: string) {
    return this.quotes.findByToken(token);
  }

  @Post(':token/approve')
  approve(@Param('token') token: string) {
    return this.quotes.approve(token);
  }

  @Post(':token/reject')
  reject(@Param('token') token: string) {
    return this.quotes.reject(token);
  }
}
