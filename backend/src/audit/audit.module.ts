import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditLogger } from './audit.logger.js';
import { AuditRetentionCron } from './audit-retention.cron.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  providers: [AuditService, AuditLogger, AuditRetentionCron, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService, AuditLogger],
})
export class AuditModule {}
