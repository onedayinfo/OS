import { Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AgentCodeService } from './agent-code.service.js';

@Controller('clients/:clientId/agent')
@Roles('ADMIN', 'AGENT')
export class ClientAgentController {
  constructor(private readonly codes: AgentCodeService) {}

  @Get()
  summary(@Param('clientId') clientId: string) {
    return this.codes.summary(clientId);
  }

  @Post('code')
  regenerate(@Param('clientId') clientId: string) {
    return this.codes.regenerate(clientId);
  }
}
