'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';

function appLinks(role: string | undefined) {
  const links = [
    { href: '/app', label: 'Fila' },
    { href: '/app/agenda', label: 'Agenda' },
  ];
  if (role === 'ADMIN' || role === 'AGENT') links.unshift({ href: '/app/dashboard', label: 'Dashboard' });
  if (role === 'AGENT') links.push({ href: '/app/campo', label: 'Campo' });
  links.push(
    { href: '/app/clientes', label: 'Clientes' },
    { href: '/app/contratos', label: 'Contratos' },
    { href: '/app/catalogo', label: 'Catálogo' },
    { href: '/app/estoque', label: 'Estoque' },
    { href: '/app/orcamentos', label: 'Orçamentos' },
    { href: '/app/ativos', label: 'Ativos' },
  );
  if (role === 'ADMIN' || role === 'AGENT') {
    links.push({ href: '/app/base-conhecimento', label: 'Base de conhecimento' });
  }
  links.push({ href: '/app/config', label: 'Configurações' });
  return links;
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`));
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useSession();

  return (
    <header className="bg-nav">
      <div className="flex items-center gap-4 px-6 py-3">
        <Link href="/app" className="shrink-0">
          <BrandMark className="h-7 w-auto text-nav-foreground" />
        </Link>
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="ghost"
            className="text-nav-muted hover:bg-white/10 hover:text-nav-foreground"
            onClick={async () => {
              await logout();
              router.replace('/app/login');
            }}
          >
            Sair
          </Button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-4 pb-3">
        {appLinks(user?.role).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors',
              isActive(pathname, l.href)
                ? 'bg-nav-active text-nav-active-foreground'
                : 'text-nav-muted hover:text-nav-foreground',
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function PortalNav() {
  const router = useRouter();
  const { logout } = useSession();

  return (
    <header className="flex items-center justify-between bg-nav px-6 py-4">
      <Link href="/portal">
        <BrandMark className="h-7 w-auto text-nav-foreground" />
      </Link>
      <Button
        variant="ghost"
        className="text-nav-muted hover:bg-white/10 hover:text-nav-foreground"
        onClick={async () => {
          await logout();
          router.replace('/portal/login');
        }}
      >
        Sair
      </Button>
    </header>
  );
}
