import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { LocationsService } from './locations.service.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';

@Controller('locations')
@Roles('ADMIN', 'AGENT')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Post()
  create(@Body() dto: CreateLocationDto) {
    return this.locations.create(dto);
  }

  @Get()
  findAll(@Query('clientId') clientId: string | undefined, @Query() query: PaginationDto) {
    return this.locations.findAll(clientId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.locations.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.locations.update(id, dto);
  }
}
