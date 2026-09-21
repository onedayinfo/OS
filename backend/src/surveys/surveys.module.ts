import { Module } from '@nestjs/common';
import { SurveysPublicController } from './surveys-public.controller.js';
import { SurveysService } from './surveys.service.js';

@Module({
  controllers: [SurveysPublicController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
