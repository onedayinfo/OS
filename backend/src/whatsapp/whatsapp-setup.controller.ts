import { Controller, Get, Post } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { Screen, SkipScreen } from '../common/screen.decorator.js';
import { EvolutionProvisioningService } from './evolution-provisioning.service.js';
import { EvolutionGroupsService } from './evolution-groups.service.js';

@Screen('config')
@Controller('whatsapp')
export class WhatsappSetupController {
  constructor(
    private readonly provisioning: EvolutionProvisioningService,
    private readonly evoGroups: EvolutionGroupsService,
  ) {}

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

  @SkipScreen()
  @Get('evolution/groups')
  @Roles('ADMIN', 'AGENT')
  groups() {
    return this.evoGroups.list();
  }

  @SkipScreen()
  @Post('evolution/groups/refresh')
  @Roles('ADMIN', 'AGENT')
  refreshGroups() {
    return this.evoGroups.forceRefresh();
  }
}
