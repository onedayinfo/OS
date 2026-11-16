import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';
import { AuditService } from './audit.service.js';

/** Consulta do log de auditoria: restrita a ADMIN. */
@Controller('audit')
@Roles('ADMIN')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() q: AuditQueryDto) {
    return this.audit.list(q);
  }

  @Get('modules')
  modules(): Promise<string[]> {
    return this.audit.modules();
  }
}
