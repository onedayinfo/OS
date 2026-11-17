import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { Screen } from '../common/screen.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Screen('dashboard')
@Controller('dashboard')
@Roles('ADMIN', 'AGENT')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }
}
