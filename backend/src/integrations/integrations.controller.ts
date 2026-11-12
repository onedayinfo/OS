import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator.js';
import { Roles } from '../common/roles.decorator.js';
import { IntegrationsService, extractToken } from './integrations.service.js';
import { IntegrationEventDto } from './dto/integration-event.dto.js';
import { CreateIntegrationDto, UpdateIntegrationDto } from './dto/integration.dto.js';

/** Webhook público: sistemas externos autenticam com o token da integração. */
@Public()
@Controller('integrations/events')
export class IntegrationEventsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Post()
  async receive(
    @Headers('authorization') auth: string | undefined,
    @Headers('x-webhook-token') headerToken: string | undefined,
    @Body() dto: IntegrationEventDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.integrations.ingest(extractToken(auth, headerToken), dto);
    res.status(result.created ? 201 : 200);
    return result;
  }
}

@Roles('ADMIN')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  findAll() {
    return this.integrations.findAll();
  }

  @Post()
  create(@Body() dto: CreateIntegrationDto) {
    return this.integrations.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrations.update(id, dto);
  }

  @Post(':id/token')
  regenerate(@Param('id') id: string) {
    return this.integrations.regenerateToken(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.integrations.remove(id);
  }
}
