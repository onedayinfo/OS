'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

const themeButtonClass =
  'flex h-8 w-8 items-center justify-center rounded-full text-nav-muted transition-colors hover:bg-white/10 hover:text-nav-foreground';

const icon = {
  grid: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  ticket: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  ),
  truck: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12l2.5-8h13L21 12M3 12v7a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-7M3 12h18" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 15h6M9 11h6" />
    </svg>
  ),
  package: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7.5 4.27 9 5.15M21 8l-9 5-9-5M21 8v8l-9 5-9-5V8m9 13V13" />
    </svg>
  ),
  boxes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2.97 12.92 12 18l9.03-5.08M2.97 7.08 12 12l9.03-5.08L12 2z" />
      <path d="M2.97 7.08v9.84L12 22V12M21.03 7.08v9.84L12 22" />
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 1V2Z" />
      <path d="M8 7h8M8 11h8M8 15h5" />
    </svg>
  ),
  wrench: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    </svg>
  ),
  book: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.64a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.04z" />
    </svg>
  ),
};

interface NavLink {
  href: string;
  label: string;
  icon: ReactNode;
}
interface NavGroup {
  label: string;
  links: NavLink[];
}

function appGroups(role: string | undefined): NavGroup[] {
  const operacao: NavLink[] = [];
  if (role === 'ADMIN' || role === 'AGENT') {
    operacao.push({ href: '/app/dashboard', label: 'Painel', icon: icon.grid });
  }
  operacao.push({ href: '/app', label: 'Fila', icon: icon.ticket });
  operacao.push({ href: '/app/agenda', label: 'Agenda', icon: icon.calendar });
  if (role === 'AGENT') operacao.push({ href: '/app/campo', label: 'Campo', icon: icon.truck });

  const cadastros: NavLink[] = [
    { href: '/app/clientes', label: 'Clientes', icon: icon.users },
    { href: '/app/contratos', label: 'Contratos', icon: icon.file },
    { href: '/app/catalogo', label: 'Catálogo', icon: icon.package },
    { href: '/app/estoque', label: 'Estoque', icon: icon.boxes },
    { href: '/app/orcamentos', label: 'Orçamentos', icon: icon.receipt },
    { href: '/app/ativos', label: 'Ativos', icon: icon.wrench },
  ];

  const sistema: NavLink[] = [];
  if (role === 'ADMIN' || role === 'AGENT') {
    sistema.push({ href: '/app/base-conhecimento', label: 'Base de conhecimento', icon: icon.book });
  }
  sistema.push({ href: '/app/config', label: 'Configurações', icon: icon.settings });

  return [
    { label: 'Operação', links: operacao },
    { label: 'Cadastros', links: cadastros },
    { label: 'Sistema', links: sistema },
  ];
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`));
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useSession();

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto bg-nav px-3 py-4 text-nav-muted">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <Link href="/app" className="min-w-0">
          <BrandMark className="h-7 w-auto max-w-full text-nav-foreground" />
        </Link>
      </div>

      {appGroups(user?.role).map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-wider text-nav-muted/80 first:pt-0">
            {group.label}
          </div>
          {group.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0',
                isActive(pathname, l.href)
                  ? 'bg-nav-active font-bold text-nav-active-foreground'
                  : 'text-nav-muted hover:bg-white/10 hover:text-nav-foreground',
              )}
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </div>
      ))}

      <div className="mt-auto flex items-center justify-between px-1 pt-3">
        <ThemeToggle className={themeButtonClass} />
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
    </aside>
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
      <div className="flex items-center gap-2">
        <ThemeToggle className={themeButtonClass} />
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
      </div>
    </header>
  );
}
