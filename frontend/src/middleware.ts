import { NextRequest, NextResponse } from 'next/server';

// Com BACKEND_INTERNAL_URL definido, encaminha /api/* para o backend na rede
// interna (avaliado em runtime, ao contrário de next.config#rewrites). Assim
// front e API ficam na mesma origem pública e nada precisa expor porta.
export function middleware(req: NextRequest) {
  const target = process.env.BACKEND_INTERNAL_URL;
  if (!target) return NextResponse.next();
  const dest = new URL(
    req.nextUrl.pathname + req.nextUrl.search,
    target.replace(/\/$/, ''),
  );
  // Defesa em profundidade: dropa o `x-forwarded-for` que veio na request do
  // cliente antes de repassar ao backend. O `clientIp` do backend usa o 1º
  // item de XFF (controlado pelo cliente) como fallback; se um dia algo além
  // do túnel alcançar o `frontend`, o atacante não injeta IP por aí.
  // `cf-connecting-ip` é MANTIDO de propósito: no túnel real o Cloudflare o
  // põe na conexão que chega ao `cloudflared`/`frontend` e é o único jeito do
  // backend saber o IP verdadeiro — removê-lo tornaria o rate limit global.
  const headers = new Headers(req.headers);
  headers.delete('x-forwarded-for');
  return NextResponse.rewrite(dest, { request: { headers } });
}

export const config = { matcher: '/api/:path*' };
