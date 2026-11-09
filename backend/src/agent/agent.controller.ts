import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { AgentService } from './agent.service.js';
import { CheckinDto } from './dto/checkin.dto.js';
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

  @Public()
  @Post('checkin')
  @HttpCode(200)
  checkin(@Headers('authorization') auth: string | undefined, @Body() dto: CheckinDto) {
    const m = /^Bearer (\S+)$/.exec(auth ?? '');
    if (!m) throw new UnauthorizedException('Token inválido.');
    return this.agent.checkin(m[1], dto);
  }
}
