'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import { Icon } from '@/components/ui/icon';
import { ThemeToggle } from '@/components/theme-toggle';

interface NavLink {
  href: string;
  label: string;
  icon: string;
}
interface NavGroup {
  label: string;
  links: NavLink[];
}

function appGroups(role: string | undefined): NavGroup[] {
  const privileged = role === 'ADMIN' || role === 'AGENT';

  const atendimento: NavLink[] = [];
  if (privileged) atendimento.push({ href: '/app/dashboard', label: 'Painel', icon: 'dashboard' });
  atendimento.push({ href: '/app', label: 'Chamados / OS', icon: 'confirmation_number' });
  atendimento.push({ href: '/app/agenda', label: 'Agenda técnica', icon: 'calendar_month' });
  if (privileged) atendimento.push({ href: '/app/triagem', label: 'Triagem WhatsApp', icon: 'forum' });
  if (role === 'AGENT') atendimento.push({ href: '/app/campo', label: 'Técnico de campo', icon: 'engineering' });

  const cadastros: NavLink[] = [
    { href: '/app/clientes', label: 'Clientes', icon: 'business' },
    { href: '/app/ativos', label: 'Parque de ativos', icon: 'devices' },
    { href: '/app/contratos', label: 'Contratos', icon: 'description' },
  ];

  const vendas: NavLink[] = [
    { href: '/app/crm', label: 'CRM', icon: 'handshake' },
    { href: '/app/orcamentos', label: 'Orçamentos', icon: 'request_quote' },
    { href: '/app/catalogo', label: 'Catálogo de serviços', icon: 'list_alt' },
    { href: '/app/estoque', label: 'Estoque e peças', icon: 'inventory_2' },
  ];

  const gestao: NavLink[] = [];
  if (privileged) gestao.push({ href: '/app/base-conhecimento', label: 'Base de conhecimento', icon: 'menu_book' });
  gestao.push({ href: '/app/config', label: 'Configurações', icon: 'settings' });

  return [
    { label: 'Atendimento', links: atendimento },
    { label: 'Cadastros e ativos', links: cadastros },
    { label: 'Suprimentos e vendas', links: vendas },
    { label: 'Gestão', links: gestao },
  ];
}

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`));
}

export function AppNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { user } = useSession();

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col justify-between overflow-y-auto bg-nav shadow-[0_1px_8px_rgba(0,0,0,0.06)] transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex flex-col">
          <div className="flex h-16 items-center gap-2 px-4">
            <Link href="/app" className="min-w-0" onClick={onClose}>
              <BrandMark className="h-8 w-auto max-w-full text-nav-foreground" />
            </Link>
          </div>

          <nav className="flex flex-col gap-5 px-2 py-2">
            {appGroups(user?.role).map((group) => (
              <div key={group.label} className="flex flex-col gap-0.5">
                <div className="label-mono px-3 py-1 text-nav-label">{group.label}</div>
                {group.links.map((l) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={onClose}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                        active
                          ? 'bg-nav-active font-semibold text-nav-active-foreground'
                          : 'text-nav-muted hover:bg-nav-hover hover:text-nav-foreground',
                      )}
                    >
                      <Icon name={l.icon} className="text-[18px]" />
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center justify-between bg-muted px-4 py-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="label-mono text-nav-label">Sistema operacional</span>
          </span>
          <ThemeToggle className="flex h-7 w-7 items-center justify-center rounded-lg text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground" />
        </div>
      </aside>
    </>
  );
}

const PORTAL_LINKS = [
  { href: '/portal', label: 'Meus chamados' },
  { href: '/portal/chamados/novo', label: 'Abrir chamado' },
];

export function PortalNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { logout, user } = useSession();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 bg-nav px-4 shadow-[0_1px_8px_rgba(0,0,0,0.06)] md:px-6">
      <Link href="/portal" className="shrink-0">
        <BrandMark className="h-8 w-auto text-nav-foreground" />
      </Link>

      <nav className="flex items-center gap-1 md:ml-4">
        {PORTAL_LINKS.map((l) => {
          const active = pathname === l.href || (l.href === '/portal' && pathname.startsWith('/portal/chamados/') && pathname !== '/portal/chamados/novo');
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-nav-active font-semibold text-nav-active-foreground'
                  : 'text-nav-muted hover:bg-nav-hover hover:text-nav-foreground',
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle className="flex h-8 w-8 items-center justify-center rounded-lg text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground" />
        {user && (
          <span className="hidden items-center gap-2 pl-1 md:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-info text-[12px] font-bold text-info-foreground">
              {user.name
                .trim()
                .split(/\s+/)
                .map((p, i, a) => (i === 0 || i === a.length - 1 ? p[0] : ''))
                .join('')
                .toUpperCase()}
            </span>
            <span className="text-[12px] font-semibold">{user.name}</span>
          </span>
        )}
        <button
          type="button"
          title="Sair"
          aria-label="Sair"
          onClick={async () => {
            await logout();
            router.replace('/portal/login');
          }}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-nav-muted transition-colors hover:bg-nav-hover hover:text-nav-foreground"
        >
          <Icon name="logout" className="text-[18px]" />
        </button>
      </div>
    </header>
  );
}
