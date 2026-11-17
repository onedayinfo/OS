import { ConsoleLogger, Injectable } from '@nestjs/common';
import { AuditService } from './audit.service.js';

/** Logger do Nest que, além de imprimir no console, persiste warn/error na auditoria. */
@Injectable()
export class AuditLogger extends ConsoleLogger {
  constructor(private readonly audit: AuditService) {
    super();
  }

  override warn(message: unknown, ...rest: unknown[]): void {
    super.warn(message, ...rest);
    this.persist('warn', message, rest);
  }

  override error(message: unknown, ...rest: unknown[]): void {
    super.error(message, ...rest);
    this.persist('error', message, rest);
  }

  private persist(level: 'warn' | 'error', message: unknown, rest: unknown[]): void {
    try {
      const strs = rest.filter((r): r is string => typeof r === 'string');
      // Contexto = último string, exceto quando é o único e parece um stack (tem quebra de linha).
      const last = strs[strs.length - 1];
      const context = last !== undefined && (strs.length > 1 || !last.includes('\n')) ? last : undefined;
      if (context === 'AuditService') return; // anti-recursão
      const stack = message instanceof Error ? message.stack : strs.find((s) => s.includes('\n'));
      this.audit.record({
        kind: 'ERROR',
        level,
        module: context ?? 'app',
        message: AuditLogger.texto(message).slice(0, 2000),
        data: { stack },
      });
    } catch (e) {
      // sem Logger aqui (recursão); o log nunca pode lançar
      process.stderr.write(`[AuditLogger] falha ao persistir: ${String(e)}
`);
    }
  }

  private static texto(message: unknown): string {
    if (message instanceof Error) return message.message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message) ?? String(message);
    } catch {
      try {
        return String(message);
      } catch {
        return '[log não serializável]';
      }
    }
  }
}
