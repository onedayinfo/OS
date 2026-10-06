'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth';
import { AppNav } from '@/components/nav';
import { Icon } from '@/components/ui/icon';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  AGENT: 'Técnico',
  MANAGER: 'Gestor',
  CONTACT: 'Contato',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const { user, logout } = useSession();
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-card/90 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl lg:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Abrir menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent lg:hidden"
      >
        <Icon name="menu" />
      </button>

      <form
        className="relative w-full max-w-xl flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const term = q.trim();
          router.push(term ? `/app?q=${encodeURIComponent(term)}` : '/app');
        }}
      >
        <Icon
          name="search"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground"
        />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar chamado por número ou título…"
          aria-label="Buscar chamado"
          className="w-full rounded-lg bg-muted py-1.5 pl-9 pr-16 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-card focus:ring-2 focus:ring-ring"
        />
        <span className="label-mono pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded bg-accent px-1.5 py-0.5 text-muted-foreground sm:block">
          Ctrl K
        </span>
      </form>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push('/app?novo=1')}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <Icon name="add" className="text-[18px]" />
          <span className="hidden sm:inline">Nova OS</span>
        </button>

        {user && (
          <div className="flex items-center gap-2 pl-1">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-info text-[12px] font-bold text-info-foreground">
              {initials(user.name)}
            </span>
            <div className="hidden flex-col text-left md:flex">
              <span className="text-[12px] font-semibold leading-tight">{user.name}</span>
              <span className="label-mono text-muted-foreground">{ROLE_LABELS[user.role] ?? user.role}</span>
            </div>
            <button
              type="button"
              title="Sair"
              aria-label="Sair"
              onClick={async () => {
                await logout();
                router.replace('/app/login');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Icon name="logout" className="text-[18px]" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <AppNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-64">
        <Topbar onMenu={() => setMenuOpen(true)} />
        <main className="min-w-0 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
