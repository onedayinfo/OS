import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import {
  ALLOWED_MIMES,
  MAX_ATTACHMENT_BYTES,
  storedName,
  type UploadedFile,
} from './storage.util.js';

/**
 * Lido a cada chamada (não em escopo de módulo) para testes trocarem o alvo,
 * mas sempre resolvido para absoluto — o `mkdir` do boot, a escrita e o download
 * usam o mesmo caminho independem do cwd. `.env` pode seguir `./uploads`.
 */
const storagePath = () => resolve(process.env.STORAGE_PATH ?? './uploads');

@Injectable()
export class AttachmentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await mkdir(storagePath(), { recursive: true });
  }

  /**
   * Anexa um arquivo a um chamado.
   * `actor` opcional: quando nulo (uso "system" do inbound de e-mail, Fase 9),
   * pula a guarda de acesso — a autoria (`uploadedById`) continua obrigatória.
   */
  async saveForTicket(
    ticketId: string,
    file: UploadedFile,
    actor?: Actor,
  ): Promise<Attachment> {
    if (actor) await this.tickets.assertAccess(ticketId, actor);
    return this.persist({ ticketId }, file, actor);
  }

  /**
   * Anexa um arquivo a um comentário. Resolve o chamado dono para a guarda de
   * acesso. `actor` opcional com a mesma semântica de `saveForTicket`.
   */
  async saveForComment(
    commentId: string,
    file: UploadedFile,
    actor?: Actor,
  ): Promise<Attachment> {
    const comment = await this.prisma.ticketComment.findUnique({
      where: { id: commentId },
      select: { ticketId: true },
    });
    if (!comment) throw new NotFoundException('Comentário não encontrado.');
    if (actor) await this.tickets.assertAccess(comment.ticketId, actor);
    return this.persist({ commentId }, file, actor);
  }

  /** Carrega o anexo validando o acesso do `actor` ao chamado dono. */
  async getForDownload(id: string, actor: Actor): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');

    let ticketId = attachment.ticketId;
    if (!ticketId && attachment.commentId) {
      const comment = await this.prisma.ticketComment.findUnique({
        where: { id: attachment.commentId },
        select: { ticketId: true },
      });
      ticketId = comment?.ticketId ?? null;
    }
    if (!ticketId) throw new NotFoundException('Anexo não encontrado.');

    // Sem acesso → NotFoundException (não vaza existência), mesmo escopo do 6.1.
    await this.tickets.assertAccess(ticketId, actor);
    return attachment;
  }

  private async persist(
    link: { ticketId: string } | { commentId: string },
    file: UploadedFile,
    actor?: Actor,
  ): Promise<Attachment> {
    if (!file) throw new BadRequestException('Arquivo ausente.');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Arquivo excede o limite de 10 MB.');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}.`);
    }

    const storedPath = join(storagePath(), storedName(file.originalname));
    await writeFile(storedPath, file.buffer);

    return this.prisma.attachment.create({
      data: {
        ...link,
        filename: file.originalname,
        storedPath,
        mime: file.mimetype,
        size: file.size,
        // ponytail: `actor` opcional só dispensa a guarda de acesso; a Fase 9
        // (inbound) precisa passar um autor concreto (contato ou usuário system).
        uploadedById: actor?.id as string,
      },
    });
  }
}
