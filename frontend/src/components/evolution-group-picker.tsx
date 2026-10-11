'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useEvolutionGroups, useRefreshEvolutionGroups, type EvolutionGroup } from '@/lib/whatsapp';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function EvolutionGroupPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (g: EvolutionGroup) => void;
}) {
  const { data, isLoading, error } = useEvolutionGroups(open);
  const refresh = useRefreshEvolutionGroups();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) setQ('');
  }, [open]);
  const list = (data?.groups ?? []).filter((g) => g.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <Dialog open={open} onClose={onClose} title="Escolher grupo da Evolution">
      <div className="flex flex-col gap-3">
        <Input aria-label="Buscar grupo" placeholder="Buscar pelo nome" value={q} onChange={(e) => setQ(e.target.value)} />
        {isLoading && <p className="text-sm text-muted-foreground">Carregando grupos…</p>}
        {data?.loading && (
          <p className="text-sm text-muted-foreground">
            Carregando grupos do WhatsApp… (a primeira vez pode levar cerca de 1 minuto)
          </p>
        )}
        {data?.error && <p className="text-sm text-destructive">{data.error} Cole o ID manualmente.</p>}
        {data && (
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {data.updatedAt
                ? `Atualizada às ${new Date(data.updatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </span>
            <Button type="button" variant="outline" disabled={data.refreshing || refresh.isPending} onClick={() => refresh.mutate()}>
              Atualizar lista
            </Button>
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive">
            {error instanceof ApiError ? error.message : 'Não foi possível listar os grupos.'} Cole o ID manualmente.
          </p>
        )}
        {data && !data.loading && list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum grupo encontrado.</p>}
        <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {list.map((g) => {
            const blocked = !!g.linkedClientId;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    onPick(g);
                    onClose();
                  }}
                  className="flex w-full flex-col rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium">{g.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.size != null ? `${g.size} participantes · ` : ''}
                    {blocked ? `já vinculado a ${g.linkedClientName}` : g.id}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Dialog>
  );
}
