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
  if (role === 'AGENT') links.push({ href: '/app/campo', label: 'Campo' });
  links.push(
    { href: '/app/clientes', label: 'Clientes' },
    { href: '/app/contratos', label: 'Contratos' },
    { href: '/app/ativos', label: 'Ativos' },
    { href: '/app/config', label: 'Configurações' },
  );
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/40 p-3">
      <div className="px-2 py-3">
        <BrandMark />
      </div>
      <nav className="flex flex-col gap-0.5">
        {appLinks(user?.role).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive(pathname, l.href)
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto">
        <Button
          variant="ghost"
          className="w-full justify-start text-muted-foreground"
          onClick={async () => {
            await logout();
            router.replace('/app/login');
          }}
        >
          Sair
        </Button>
      </div>
    </aside>
  );
}

export function PortalNav() {
  const router = useRouter();
  const { logout } = useSession();

  return (
    <header className="flex items-center justify-between border-b border-border px-6 py-3">
      <Link href="/portal">
        <BrandMark />
      </Link>
      <Button
        variant="ghost"
        className="text-muted-foreground"
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
