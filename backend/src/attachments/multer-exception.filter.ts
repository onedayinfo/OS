import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

/**
 * Multer emite `MulterError` (ex. `LIMIT_FILE_SIZE` quando o upload passa de
 * 10 MB); o Nest não mapeia isso e devolve 500. Aqui:
 * - `LIMIT_FILE_SIZE` → 413 Payload Too Large
 * - qualquer outro `MulterError` → 400 Bad Request
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(err: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const ex =
      err.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException('Arquivo excede o limite de 10 MB.')
        : new BadRequestException(`Upload inválido: ${err.message}`);
    res.status(ex.getStatus()).json(ex.getResponse());
  }
}
