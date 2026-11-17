import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ScreenKey } from './screens.js';
import type { UpdateUserGroupDto, UserGroupDto } from './dto/user-group.dto.js';

@Injectable()
export class UserGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin pleno = ADMIN sem grupo. */
  async isFullAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, groupId: true },
    });
    return !!u && u.role === 'ADMIN' && !u.groupId;
  }

  /** Telas liberadas ao usuário; `null` = sem restrição (sem grupo ou CLIENT). */
  async screensFor(userId: string): Promise<ScreenKey[] | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { type: true, group: { select: { screens: true } } },
    });
    if (!u || u.type === 'CLIENT' || !u.group) return null;
    return u.group.screens as ScreenKey[];
  }

  async findAll() {
    const rows = await this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      screens: g.screens,
      memberCount: g._count.members,
    }));
  }

  create(dto: UserGroupDto) {
    return this.guard(() =>
      this.prisma.userGroup.create({ data: { name: dto.name, screens: dto.screens } }),
    );
  }

  update(id: string, dto: UpdateUserGroupDto) {
    return this.guard(() =>
      this.prisma.userGroup.update({
        where: { id },
        data: { name: dto.name, screens: dto.screens },
      }),
    );
  }

  async remove(id: string) {
    await this.guard(() => this.prisma.userGroup.delete({ where: { id } }));
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Já existe um grupo com esse nome.');
      if (e?.code === 'P2025') throw new NotFoundException('Grupo não encontrado.');
      throw e;
    }
  }
}
