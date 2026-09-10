import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/roles.decorator.js';
import type { UploadedFile as UF } from '../attachments/storage.util.js';
import { AssetsService } from './assets.service.js';
import { AssetsImportService } from './assets-import.service.js';
import { CreateAssetDto } from './dto/create-asset.dto.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { ListAssetsDto } from './dto/list-assets.dto.js';

@Controller('assets')
@Roles('ADMIN', 'AGENT')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly importer: AssetsImportService,
  ) {}

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(@UploadedFile() file: UF) {
    if (!file) throw new BadRequestException('Arquivo ausente.');
    return this.importer.import(file.buffer);
  }

  @Post()
  create(@Body() dto: CreateAssetDto) {
    return this.assets.create(dto);
  }

  @Get()
  findAll(@Query() query: ListAssetsDto) {
    return this.assets.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assets.findOne(id);
  }

  @Get(':id/credentials')
  reveal(@Param('id') id: string) {
    return this.assets.revealCredentials(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(id, dto);
  }
}
