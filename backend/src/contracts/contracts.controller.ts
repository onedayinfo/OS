import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../common/roles.decorator.js';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { ListContractsDto } from './dto/list-contracts.dto.js';

@Controller('contracts')
@Roles('ADMIN', 'AGENT')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  findAll(@Query() query: ListContractsDto) {
    return this.contracts.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contracts.findOne(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateContractDto) {
    return this.contracts.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(id, dto);
  }

  @Post(':id/cancel')
  @Roles('ADMIN')
  cancel(@Param('id') id: string) {
    return this.contracts.cancel(id);
  }
}
