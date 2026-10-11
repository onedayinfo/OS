import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeText } from './text.util.js';
import type { CreatePhraseDto, UpdatePhraseDto } from './dto/phrase.dto.js';

@Injectable()
export class TriggerPhrasesService {
  constructor(private readonly prisma: PrismaService) {}

  /** `null` = padrão global. */
  list(clientId: string | null) {
    return this.prisma.triggerPhrase.findMany({ where: { clientId }, orderBy: { phraseNorm: 'asc' } });
  }

  private async assertCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const c = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!c) throw new BadRequestException('Categoria não encontrada.');
  }

  /** O índice único não protege o escopo global (NULL ≠ NULL no Postgres): checa aqui. */
  private async assertUnique(clientId: string | null, phraseNorm: string, exceptId?: string) {
    const dup = await this.prisma.triggerPhrase.findFirst({
      where: { clientId, phraseNorm, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (dup) throw new BadRequestException('Já existe uma frase igual neste escopo.');
  }

  async create(dto: CreatePhraseDto) {
    const phrase = dto.phrase.trim();
    const phraseNorm = normalizeText(phrase);
    if (!phraseNorm) throw new BadRequestException('Informe a frase.');
    const clientId = dto.clientId ?? null;
    await this.assertCategory(dto.categoryId);
    await this.assertUnique(clientId, phraseNorm);
    return this.prisma.triggerPhrase.create({
      data: {
        clientId,
        phrase,
        phraseNorm,
        categoryId: dto.categoryId ?? null,
        priority: dto.priority ?? 'MEDIUM',
        title: dto.title?.trim() || null,
      },
    });
  }

  async update(id: string, dto: UpdatePhraseDto) {
    const found = await this.prisma.triggerPhrase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Frase não encontrada.');
    const data: Record<string, unknown> = {};
    if (dto.phrase !== undefined) {
      const phrase = dto.phrase.trim();
      const phraseNorm = normalizeText(phrase);
      if (!phraseNorm) throw new BadRequestException('Informe a frase.');
      await this.assertUnique(found.clientId, phraseNorm, id);
      data.phrase = phrase;
      data.phraseNorm = phraseNorm;
    }
    if (dto.categoryId !== undefined) {
      await this.assertCategory(dto.categoryId);
      data.categoryId = dto.categoryId || null;
    }
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.title !== undefined) data.title = dto.title?.trim() || null;
    if (dto.active !== undefined) data.active = dto.active;
    return this.prisma.triggerPhrase.update({ where: { id }, data });
  }

  async remove(id: string) {
    const found = await this.prisma.triggerPhrase.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Frase não encontrada.');
    return this.prisma.triggerPhrase.delete({ where: { id } });
  }

  /** Copia o padrão global (só as ativas) para o cliente, pulando as que ele já tem. */
  async applyDefaults(clientId: string): Promise<{ created: number }> {
    const globals = await this.prisma.triggerPhrase.findMany({ where: { clientId: null, active: true } });
    const mine = await this.prisma.triggerPhrase.findMany({ where: { clientId }, select: { phraseNorm: true } });
    const have = new Set(mine.map((p) => p.phraseNorm));
    const data = globals
      .filter((g) => !have.has(g.phraseNorm))
      .map((g) => ({
        clientId,
        phrase: g.phrase,
        phraseNorm: g.phraseNorm,
        categoryId: g.categoryId,
        priority: g.priority,
        title: g.title,
      }));
    if (!data.length) return { created: 0 };
    const r = await this.prisma.triggerPhrase.createMany({ data, skipDuplicates: true });
    return { created: r.count };
  }
}
