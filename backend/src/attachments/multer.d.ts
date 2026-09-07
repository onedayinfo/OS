// Shim mínimo: `multer` (dep transitiva do @nestjs/platform-express) não traz
// `.d.ts` e `@types/multer` não está instalado. Só o que o filter usa.
declare module 'multer' {
  export class MulterError extends Error {
    code: string;
    field?: string;
    constructor(code: string, field?: string);
  }
}
