import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { SlaService } from './sla.service.js';
import { UpdateSlaDto } from './dto/update-sla.dto.js';

@Controller('sla')
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get()
  findAll() {
    return this.sla.findAll();
  }

  @Patch(':priority')
  @Roles('ADMIN')
  update(@Param('priority') priority: string, @Body() dto: UpdateSlaDto) {
    return this.sla.update(priority, dto);
  }
}
