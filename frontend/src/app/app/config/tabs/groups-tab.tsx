'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { SCREENS, SCREEN_LABELS } from '@/lib/screens';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface UserGroup {
  id: string;
  name: string;
  screens: string[];
  memberCount: number;
}

export default function GroupsTab() {
  const qc = useQueryClient();
  // null = modal fechado; id vazio = novo grupo
  const [editing, setEditing] = useState<{ id: string; name: string; screens: string[] } | null>(null);

  const { data } = useQuery({
    queryKey: ['user-groups'],
    queryFn: () => api<UserGroup[]>('/user-groups'),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['user-groups'] });
    qc.invalidateQueries({ queryKey: ['users'] });
  };
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

  const save = useMutation({
    mutationFn: (g: { id: string; name: string; screens: string[] }) =>
      g.id
        ? api(`/user-groups/${g.id}`, { method: 'PATCH', body: { name: g.name, screens: g.screens } })
        : api('/user-groups', { method: 'POST', body: { name: g.name, screens: g.screens } }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success('Grupo salvo.');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/user-groups/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      toast.success('Grupo excluído.');
    },
    onError,
  });

  function toggle(key: string) {
    setEditing(
      (g) =>
        g && {
          ...g,
          screens: g.screens.includes(key) ? g.screens.filter((s) => s !== key) : [...g.screens, key],
        },
    );
  }

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div>
        <Button onClick={() => setEditing({ id: '', name: '', screens: [] })}>Novo grupo</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Nome</th>
              <th className="px-3 py-2 font-medium">Telas</th>
              <th className="px-3 py-2 font-medium">Membros</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((g) => (
              <tr key={g.id} className="border-t border-border">
                <td className="px-3 py-2">{g.name}</td>
                <td className="px-3 py-2">{g.screens.length}</td>
                <td className="px-3 py-2">{g.memberCount}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setEditing({ id: g.id, name: g.name, screens: g.screens })}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-red-600 hover:underline"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Os ${g.memberCount} membros deste grupo ficarão sem restrição de telas. Excluir mesmo assim?`,
                          )
                        )
                          remove.mutate(g.id);
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar grupo' : 'Novo grupo'}>
        {editing && (
          <form
            className="flex flex-col gap-4 overflow-y-auto p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing.name.trim()) return toast.error('Informe o nome do grupo.');
              save.mutate({ ...editing, name: editing.name.trim() });
            }}
          >
            <Input
              placeholder="Nome do grupo"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              {SCREENS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.screens.includes(key)} onChange={() => toggle(key)} />
                  {SCREEN_LABELS[key]}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Salvar
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
