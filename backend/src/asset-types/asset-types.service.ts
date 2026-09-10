import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateAssetTypeDto } from './dto/create-asset-type.dto.js';
import { UpdateAssetTypeDto } from './dto/update-asset-type.dto.js';

const SEED = [
  'Câmera',
  'DVR/NVR',
  'Switch',
  'Roteador',
  'No-break',
  'Servidor',
  'Desktop',
  'Central de alarme',
  'Controladora de acesso',
  'Cerca elétrica',
  'Catraca',
  'Fechadura eletrônica',
];

@Injectable()
export class AssetTypesService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.assetType.createMany({
      data: SEED.map((name) => ({ name })),
      skipDuplicates: true,
    });
  }

  create(dto: CreateAssetTypeDto) {
    return this.prisma.assetType.create({ data: { name: dto.name } });
  }

  /** Todos (ativos e inativos): a config da equipe precisa dos inativos para reativar. */
  findAll() {
    return this.prisma.assetType.findMany({ orderBy: { name: 'asc' } });
  }

  async update(id: string, dto: UpdateAssetTypeDto) {
    const found = await this.prisma.assetType.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Tipo de ativo não encontrado.');
    return this.prisma.assetType.update({ where: { id }, data: dto });
  }
}
