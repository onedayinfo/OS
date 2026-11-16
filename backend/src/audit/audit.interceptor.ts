import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import type { CurrentUserData } from '../common/current-user.decorator.js';
import { AuditService } from './audit.service.js';

const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXCLUIDOS = [
  '/api/agent/checkin',
  '/api/integrations/events',
  '/api/webhooks/resend',
  '/api/whatsapp/webhook',
  '/api/auth/refresh',
];

type Arquivo = { originalname: string; size: number; mimetype: string };

/** Registra no log de auditoria toda ação de escrita (POST/PUT/PATCH/DELETE). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const path: string = String(req.originalUrl ?? req.url ?? '').split('?')[0];
    if (!METODOS.has(req.method) || EXCLUIDOS.some((p) => path.startsWith(p))) {
      return next.handle();
    }
    const res = http.getResponse();
    return next.handle().pipe(
      tap(() => this.gravar(req, path, res.statusCode)),
      catchError((err) => {
        this.gravar(req, path, err?.getStatus?.() ?? 500);
        return throwError(() => err);
      }),
    );
  }

  private gravar(req: any, path: string, status: number): void {
    try {
      const user: CurrentUserData | undefined = req.user;
      // req.files: array (multer .array) ou objeto de arrays (multer .fields)
      const f = req.files;
      const lista: Arquivo[] = [req.file, ...(Array.isArray(f) ? f : f ? Object.values(f).flat() : [])].filter(Boolean);
      const arquivos = lista.map((x) => ({ name: x.originalname, size: x.size, mime: x.mimetype }));
      this.audit.record({
        kind: 'ACTION',
        level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
        module: path.split('/')[2] ?? '',
        message: `${req.method} ${path}`,
        actorId: user?.id ?? null,
        actorLabel: user ? null : (req.body?.email ?? null),
        ip: req.ip ?? null,
        method: req.method,
        path,
        status,
        data: { body: req.body, files: arquivos },
      });
    } catch {
      // ponytail: auditoria nunca derruba a requisição
    }
  }
}
