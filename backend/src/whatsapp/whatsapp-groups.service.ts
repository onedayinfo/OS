import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { isUniqueViolation } from './db-errors.js';
import type { CreateGroupDto, UpdateGroupDto } from './dto/group.dto.js';

// "120363...@g.us" ou o formato antigo "5511999990000-1630000000@g.us"
const GROUP_JID = /^\d+(-\d+)?@g\.us$/;

@Injectable()
export class WhatsappGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  list(clientId: string) {
    return this.prisma.whatsappGroup.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  }

  async create(dto: CreateGroupDto) {
    const externalId = dto.externalId.trim();
    if (!GROUP_JID.test(externalId)) {
      throw new BadRequestException('ID inválido: use o formato 120363000000000001@g.us (copie da Evolution).');
    }
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Cliente não encontrado.');
    try {
      return await this.prisma.whatsappGroup.create({
        data: { externalId, name: dto.name?.trim() || null, clientId: dto.clientId },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const other = await this.prisma.whatsappGroup.findUnique({
          where: { externalId },
          include: { client: { select: { name: true } } },
        });
        throw new ConflictException(`Este grupo já está cadastrado no cliente "${other?.client.name ?? 'outro'}".`);
      }
      throw e;
    }
  }

  update(id: string, dto: UpdateGroupDto) {
    const data: { name?: string | null; active?: boolean } = {};
    if (dto.name !== undefined) data.name = dto.name.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.whatsappGroup.update({ where: { id }, data });
  }

  /** Apaga o grupo e, em cascata, as mensagens gravadas dele (a UI avisa). */
  remove(id: string) {
    return this.prisma.whatsappGroup.delete({ where: { id } });
  }
}
