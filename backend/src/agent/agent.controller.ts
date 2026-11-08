import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { AgentService } from './agent.service.js';
import { EnrollDto } from './dto/enroll.dto.js';

// Autenticado pelo código de instalação (no corpo), não por JWT.
@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Public()
  @Post('enroll')
  @HttpCode(200)
  enroll(@Body() dto: EnrollDto) {
    return this.agent.enroll(dto);
  }
}
