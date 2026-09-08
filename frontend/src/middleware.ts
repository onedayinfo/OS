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
  return NextResponse.rewrite(dest);
}

export const config = { matcher: '/api/:path*' };
