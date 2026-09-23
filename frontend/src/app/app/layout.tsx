'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { AppNav } from '@/components/nav';

// Telas de acesso ficam sob /app mas não passam pela guarda de sessão.
const PUBLIC_PATHS = ['/app/login', '/app/definir-senha'];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const allowed = user?.type === 'INTERNAL';

  useEffect(() => {
    if (isPublic || loading) return;
    if (!allowed) router.replace('/app/login');
  }, [isPublic, loading, allowed, router]);

  if (isPublic) {
    return <div className="min-h-screen bg-muted/30">{children}</div>;
  }

  if (loading || !allowed) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="p-8">{children}</main>
    </div>
  );
}
