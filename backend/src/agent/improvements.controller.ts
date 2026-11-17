import { Controller, Get, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { Roles } from '../common/roles.decorator.js';
import { Screen } from '../common/screen.decorator.js';
import { ImprovementsService } from './improvements.service.js';

class ImprovementsQueryDto {
  @IsOptional() @IsString() clientId?: string;
}

@Roles('ADMIN', 'AGENT')
@Screen('ativos')
@Controller('agent/improvements')
export class ImprovementsController {
  constructor(private readonly svc: ImprovementsService) {}

  @Get() overview(@Query() q: ImprovementsQueryDto) { return this.svc.overview(q.clientId); }
}
