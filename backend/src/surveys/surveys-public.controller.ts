import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/public.decorator.js';
import { SurveysService } from './surveys.service.js';
import { RespondSurveyDto } from './dto/respond-survey.dto.js';

@Controller('public/surveys')
@Public()
export class SurveysPublicController {
  constructor(private readonly surveys: SurveysService) {}

  @Get(':token')
  find(@Param('token') token: string) {
    return this.surveys.findByToken(token);
  }

  @Post(':token')
  respond(@Param('token') token: string, @Body() dto: RespondSurveyDto) {
    return this.surveys.respond(token, dto);
  }
}
