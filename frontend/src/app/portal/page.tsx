'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  STATUS_LABELS,
  useTickets,
  type TicketFilters,
  type TicketStatus,
} from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Lista de chamados do cliente. O backend já escopa por papel (CONTACT: os seus;
// MANAGER: todos da empresa), então o front não filtra por solicitante.
export default function PortalHomePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<TicketFilters>({ page: 1, pageSize: 20 });
  const { data, isLoading, isError } = useTickets(filters);

  function patch(p: Partial<TicketFilters>) {
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));
  }

  const rows = data?.data ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const page = filters.page ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Meus chamados</h1>
        <Button onClick={() => router.push('/portal/chamados/novo')}>Abrir chamado</Button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          placeholder="Buscar por número ou título"
          className="h-9 w-64"
          defaultValue={filters.q ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') patch({ q: (e.target as HTMLInputElement).value.trim() });
          }}
        />
        <Select
          className="h-9 w-48"
          value={filters.status ?? ''}
          onChange={(e) => patch({ status: e.target.value as TicketStatus | '' })}
        >
          <option value="">Status: todos</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Número</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-red-600">
                  Erro ao carregar chamados.
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum chamado encontrado.
                </td>
              </tr>
            )}
            {rows.map((t) => (
              <tr
                key={t.id}
                onClick={() => router.push(`/portal/chamados/${t.id}`)}
                className="cursor-pointer border-t border-border hover:bg-accent"
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{t.number}</td>
                <td className="px-3 py-2">{t.title}</td>
                <td className="px-3 py-2">
                  <Badge tone="neutral">{STATUS_LABELS[t.status]}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {fmtDate(t.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{data?.total ?? 0} chamado(s)</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8"
            disabled={page <= 1}
            onClick={() => patch({ page: page - 1 })}
          >
            Anterior
          </Button>
          <span>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            className="h-8"
            disabled={page >= totalPages}
            onClick={() => patch({ page: page + 1 })}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
