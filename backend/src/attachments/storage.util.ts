import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

/** Teto de tamanho de anexo (10 MB). Aplicado no interceptor e no service. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** MIMEs aceitos (spec §5.4 / §7): imagens comuns, pdf, texto, zip, binário genérico. */
export const ALLOWED_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/octet-stream',
]);

/** Formato mínimo de arquivo recebido — evita depender de `@types/multer`. */
export type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

/** Extensão sanitizada: só `.\w+` (ex. `.png`), senão string vazia. */
export function safeExt(originalname: string): string {
  const ext = extname(originalname ?? '');
  return /^\.\w+$/.test(ext) ? ext : '';
}

/** Nome de armazenamento previsível: `<uuid><ext>` dentro do STORAGE_PATH. */
export function storedName(originalname: string): string {
  return `${randomUUID()}${safeExt(originalname)}`;
}
