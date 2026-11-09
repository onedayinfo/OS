import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AgentDevicesService } from './agent-devices.service.js';
import { ApproveDeviceDto } from './dto/approve-device.dto.js';
import { LinkDeviceDto } from './dto/link-device.dto.js';
import { ListDevicesDto } from './dto/list-devices.dto.js';

@Roles('ADMIN', 'AGENT')
@Controller('agent-devices')
export class AgentDevicesController {
  constructor(private readonly svc: AgentDevicesService) {}

  @Get() list(@Query() q: ListDevicesDto) { return this.svc.list(q); }
  @Get(':id') one(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post(':id/approve') @HttpCode(200) approve(@Param('id') id: string, @Body() dto: ApproveDeviceDto) { return this.svc.approve(id, dto); }
  @Post(':id/link') @HttpCode(200) link(@Param('id') id: string, @Body() dto: LinkDeviceDto) { return this.svc.link(id, dto.assetId); }
  @Post(':id/ignore') @HttpCode(200) ignore(@Param('id') id: string) { return this.svc.ignore(id); }
  @Post(':id/restore') @HttpCode(200) restore(@Param('id') id: string) { return this.svc.restore(id); }
}
