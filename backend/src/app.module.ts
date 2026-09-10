import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { StorageModule } from './storage/storage.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { BackupModule } from './backup/backup.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { CategoriesModule } from './categories/categories.module.js';
import { AssetTypesModule } from './asset-types/asset-types.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { UsersModule } from './users/users.module.js';
import { EmailModule } from './email/email.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SlaModule } from './sla/sla.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { AttachmentsModule } from './attachments/attachments.module.js';
import { InboundModule } from './inbound/inbound.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SettingsModule,
    StorageModule,
    BrandingModule,
    BackupModule,
    AuthModule,
    CommonModule,
    ClientsModule,
    CategoriesModule,
    AssetTypesModule,
    LocationsModule,
    UsersModule,
    EmailModule,
    NotificationsModule,
    SlaModule,
    TicketsModule,
    CommentsModule,
    AttachmentsModule,
    InboundModule,
    TasksModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
