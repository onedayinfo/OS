'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/auth';

// ponytail: QueryClient singleton de módulo (o frontend é client-side; não há
// prefetch em RSC que exigiria uma instância por request).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>{children}</SessionProvider>
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
