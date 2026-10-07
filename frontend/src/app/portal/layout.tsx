'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { PortalNav } from '@/components/nav';

const PUBLIC_PATHS = ['/portal/login', '/portal/definir-senha'];

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const allowed = user?.type === 'CLIENT';

  useEffect(() => {
    if (isPublic || loading) return;
    if (!allowed) router.replace('/portal/login');
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
      <PortalNav />
      <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
    </div>
  );
}
