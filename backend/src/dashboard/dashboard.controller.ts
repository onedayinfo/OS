import { Controller, Get } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@Roles('ADMIN', 'AGENT')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }
}
