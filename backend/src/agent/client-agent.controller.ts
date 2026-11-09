import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('installer')
  async installer(@Param('clientId') clientId: string, @Res() res: Response) {
    const { path, filename } = await this.codes.installer(clientId);
    res.type('application/x-msi');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await pipeline(createReadStream(path), res);
  }

  @Post('code')
  regenerate(@Param('clientId') clientId: string) {
    return this.codes.regenerate(clientId);
  }
}
