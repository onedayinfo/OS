import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { EvolutionProvisioningService } from './evolution-provisioning.service.js';

@Controller('whatsapp')
export class WhatsappSetupController {
  constructor(private readonly provisioning: EvolutionProvisioningService) {}

  @Post('connect')
  @Roles('ADMIN')
  connect() {
    return this.provisioning.connect();
  }

  @Get('setup')
  @Roles('ADMIN')
  setup() {
    return this.provisioning.setup();
  }
}
