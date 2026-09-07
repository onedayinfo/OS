'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  getAccessToken,
  setAccessToken,
  setSessionExpiredHandler,
} from './api';

export type UserType = 'INTERNAL' | 'CLIENT';
export type UserRole = 'ADMIN' | 'AGENT' | 'MANAGER' | 'CONTACT';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  type: UserType;
  role: UserRole;
  clientId: string | null;
}

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Liga o callback de "sessão expirada" do api.ts ao estado + redireciona pro
  // login da área correspondente (decidido pela URL atual).
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      router.replace(path.startsWith('/portal') ? '/portal/login' : '/app/login');
    });
    return () => setSessionExpiredHandler(null);
  }, [router]);

  // No mount: hidrata `user` via /auth/me se houver token guardado.
  useEffect(() => {
    let alive = true;
    if (!getAccessToken()) {
      setLoading(false);
      return;
    }
    api<SessionUser>('/auth/me')
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ accessToken: string; user: SessionUser }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // best-effort
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession precisa estar dentro de <SessionProvider>.');
  return ctx;
}
