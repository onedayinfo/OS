import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { Attachment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TicketsService, publicAttachment } from '../tickets/tickets.service.js';
import type { Actor } from '../tickets/tickets.service.js';
import {
  ALLOWED_MIMES,
  MAX_ATTACHMENT_BYTES,
  storedName,
  type UploadedFile,
} from './storage.util.js';

/** Só usado no `onModuleInit` do driver de disco. */
const storagePath = () => resolve(process.env.STORAGE_PATH ?? './uploads');

@Injectable()
export class AttachmentsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly storage: StorageService,
  ) {}

  async onModuleInit(): Promise<void> {
    if ((await this.storage.activeDriver()) === 'disk') {
      await mkdir(storagePath(), { recursive: true });
    }
  }

  /** Passa-through para o download resolver a origem (disco legado ou driver ativo). */
  readable(storedPath: string) {
    return this.storage.readable(storedPath);
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
  ): Promise<ReturnType<typeof publicAttachment>> {
    if (actor) await this.tickets.assertAccess(ticketId, actor);
    return publicAttachment(await this.persist({ ticketId }, file, actor));
  }

  /**
   * Anexa um arquivo a um comentário. Resolve o chamado dono para a guarda de
   * acesso. `actor` opcional com a mesma semântica de `saveForTicket`.
   */
  async saveForComment(
    commentId: string,
    file: UploadedFile,
    actor?: Actor,
  ): Promise<ReturnType<typeof publicAttachment>> {
    const comment = await this.prisma.ticketComment.findUnique({
      where: { id: commentId },
      select: { ticketId: true },
    });
    if (!comment) throw new NotFoundException('Comentário não encontrado.');
    if (actor) await this.tickets.assertAccess(comment.ticketId, actor);
    return publicAttachment(await this.persist({ commentId }, file, actor));
  }

  /**
   * Anexa um arquivo a um ativo (foto). Recurso interno: só ADMIN/AGENT no
   * controller; `actor` sempre concreto. Não depende do `AssetsService` —
   * checa a existência direto pelo `prisma`.
   */
  async saveForAsset(
    assetId: string,
    file: UploadedFile,
    actor: Actor,
  ): Promise<ReturnType<typeof publicAttachment>> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('Ativo não encontrado.');
    return publicAttachment(await this.persist({ assetId }, file, actor));
  }

  listForAsset(assetId: string) {
    return this.prisma.attachment
      .findMany({ where: { assetId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map(publicAttachment));
  }

  /**
   * Anexa uma foto ou assinatura a uma visita. Recurso interno: só ADMIN/AGENT
   * no controller. Não depende do `VisitsService` — checa a existência direto
   * pelo `prisma`, mesmo padrão de `saveForAsset`.
   */
  async saveForVisit(
    visitId: string,
    file: UploadedFile,
    actor: Actor,
    kind: 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE',
  ): Promise<ReturnType<typeof publicAttachment>> {
    const visit = await this.prisma.visit.findUnique({ where: { id: visitId }, select: { id: true } });
    if (!visit) throw new NotFoundException('Visita não encontrada.');
    return publicAttachment(await this.persist({ visitId }, file, actor, kind));
  }

  listForVisit(visitId: string) {
    return this.prisma.attachment
      .findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map(publicAttachment));
  }

  /**
   * Anexa um arquivo a um artigo da base de conhecimento (manual, foto).
   * Recurso interno: só ADMIN/AGENT no controller. Não depende de
   * `KnowledgeService` — checa a existência direto pelo `prisma`, mesmo
   * padrão de `saveForAsset`/`saveForVisit`.
   */
  async saveForArticle(
    articleId: string,
    file: UploadedFile,
    actor: Actor,
  ): Promise<ReturnType<typeof publicAttachment>> {
    const article = await this.prisma.knowledgeArticle.findUnique({
      where: { id: articleId },
      select: { id: true },
    });
    if (!article) throw new NotFoundException('Artigo não encontrado.');
    return publicAttachment(await this.persist({ articleId }, file, actor));
  }

  listForArticle(articleId: string) {
    return this.prisma.attachment
      .findMany({ where: { articleId }, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map(publicAttachment));
  }

  /** Carrega o anexo validando o acesso do `actor` ao chamado dono. */
  async getForDownload(id: string, actor: Actor): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('Anexo não encontrado.');

    let ticketId = attachment.ticketId;
    if (!ticketId && attachment.commentId) {
      const comment = await this.prisma.ticketComment.findUnique({
        where: { id: attachment.commentId },
        select: { ticketId: true, visibility: true },
      });
      ticketId = comment?.ticketId ?? null;
      // IDOR: acesso ao ticket não basta para anexo de comentário INTERNAL.
      // Um contato CLIENT nunca enxerga comentários internos (mesmo filtro de
      // `tickets.service` ao listar), então também não baixa os anexos deles.
      // NotFoundException para não vazar a existência do anexo.
      if (comment?.visibility === 'INTERNAL' && actor?.type === 'CLIENT') {
        throw new NotFoundException('Anexo não encontrado.');
      }
    }
    // Anexo de ativo: recurso interno. Cliente nunca baixa.
    if (!ticketId && !attachment.commentId && attachment.assetId) {
      if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
      return attachment;
    }
    // Anexo de visita: recurso interno (fotos/assinatura). Cliente nunca baixa.
    if (!ticketId && !attachment.commentId && !attachment.assetId && attachment.visitId) {
      if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
      return attachment;
    }
    // Anexo de artigo da base de conhecimento: recurso interno. Cliente nunca baixa.
    if (!ticketId && !attachment.commentId && !attachment.assetId && !attachment.visitId && attachment.articleId) {
      if (actor?.type === 'CLIENT') throw new NotFoundException('Anexo não encontrado.');
      return attachment;
    }
    if (!ticketId) throw new NotFoundException('Anexo não encontrado.');

    // Sem acesso → NotFoundException (não vaza existência), mesmo escopo do 6.1.
    await this.tickets.assertAccess(ticketId, actor);
    return attachment;
  }

  private async persist(
    link: { ticketId: string } | { commentId: string } | { assetId: string } | { visitId: string } | { articleId: string },
    file: UploadedFile,
    actor?: Actor,
    kind: 'GENERIC' | 'PHOTO_BEFORE' | 'PHOTO_AFTER' | 'SIGNATURE' | 'REPORT' = 'GENERIC',
  ): Promise<Attachment> {
    if (!file) throw new BadRequestException('Arquivo ausente.');
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Arquivo excede o limite de 10 MB.');
    }
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      throw new BadRequestException(`Tipo de arquivo não permitido: ${file.mimetype}.`);
    }

    // `storedPath` agora é uma *key* relativa (`attachments/<uuid><ext>`), não
    // um caminho absoluto. Linhas antigas seguem com caminho absoluto e são
    // resolvidas pelo dual-read do StorageService.
    const key = `attachments/${storedName(file.originalname)}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    return this.prisma.attachment.create({
      data: {
        ...link,
        kind,
        filename: file.originalname,
        storedPath: key,
        mime: file.mimetype,
        size: file.size,
        // ponytail: `actor` opcional só dispensa a guarda de acesso; a Fase 9
        // (inbound) precisa passar um autor concreto (contato ou usuário system).
        uploadedById: actor?.id as string,
      },
    });
  }
}
