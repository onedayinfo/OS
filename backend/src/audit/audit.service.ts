import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditQueryDto } from './dto/audit-query.dto.js';
import { limitSize, redact } from './redact.js';

export type AuditEntry = {
  kind: 'ACTION' | 'ERROR';
  level: 'info' | 'warn' | 'error';
  module: string;
  message: string;
  actorId?: string | null;
  actorLabel?: string | null;
  ip?: string | null;
  method?: string;
  path?: string;
  status?: number;
  data?: unknown;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget: nunca lança nem usa o Logger (evita loop); falha vai para stderr. */
  record(e: AuditEntry): void {
    const falha = (err: unknown) =>
      process.stderr.write(`[audit] falha ao gravar log: ${err instanceof Error ? err.message : String(err)}
`);
    try {
      const data = limitSize(redact(e.data));
      this.prisma.auditLog
        .create({
          data: {
            kind: e.kind,
            level: e.level,
            module: e.module,
            message: e.message,
            actorId: e.actorId ?? null,
            actorLabel: e.actorLabel ?? null,
            ip: e.ip ?? null,
            method: e.method,
            path: e.path,
            status: e.status,
            data: data === undefined || data === null ? Prisma.JsonNull : (data as Prisma.InputJsonValue),
          },
        })
        .catch(falha);
    } catch (err) {
      falha(err); // ex.: referência circular / BigInt em `data`
    }
  }

  async list({ page = 1, pageSize = 20, q, kind, actorId, module, from, to }: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(kind && { kind }),
      ...(actorId && { actorId }),
      ...(module && { module }),
      ...((from || to) && {
        createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) },
      }),
      ...(q && {
        OR: [
          { message: { contains: q, mode: 'insensitive' } },
          { path: { contains: q, mode: 'insensitive' } },
        ],
      }),
    };
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, total, page, pageSize };
  }

  /** Módulos que já têm registros, para o filtro da tela. */
  async modules(): Promise<string[]> {
    const rows = await this.prisma.auditLog.findMany({
      distinct: ['module'],
      select: { module: true },
      orderBy: { module: 'asc' },
    });
    return rows.map((r) => r.module);
  }

  async purgeOlderThan(days: number): Promise<number> {
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });
    return count;
  }
}
