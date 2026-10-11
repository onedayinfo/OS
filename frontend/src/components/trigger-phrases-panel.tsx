'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { PRIORITY_LABELS, type TicketPriority } from '@/lib/tickets';
import {
  useApplyDefaults,
  usePhrases,
  useRemovePhrase,
  useSavePhrase,
  type TriggerPhrase,
} from '@/lib/whatsapp';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

interface Category { id: string; name: string }

/** Lista/edita frases de gatilho. `clientId = null` edita o PADRÃO GLOBAL. */
export function TriggerPhrasesPanel({ clientId }: { clientId: string | null }) {
  const { data: phrases } = usePhrases(clientId);
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const save = useSavePhrase(clientId);
  const remove = useRemovePhrase(clientId);
  const defaults = useApplyDefaults(clientId ?? '');

  const [editing, setEditing] = useState<Partial<TriggerPhrase> | null>(null);

  const catName = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? '—';

  function submit() {
    if (!editing?.phrase?.trim()) return;
    save.mutate(
      {
        id: editing.id,
        phrase: editing.phrase,
        categoryId: editing.categoryId || null,
        priority: editing.priority ?? 'MEDIUM',
        title: editing.title || null,
      },
      {
        onSuccess: () => {
          setEditing(null);
          toast.success('Frase salva.');
        },
        onError: errToast,
      },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Quando uma mensagem do grupo <b>começa</b> com a frase (sem diferenciar maiúsculas e acentos), o
          chamado é aberto na hora. O resto da mensagem vira a descrição.
        </p>
        <div className="flex gap-2">
          {clientId && (
            <Button
              variant="outline"
              disabled={defaults.isPending}
              onClick={() =>
                defaults.mutate(undefined, {
                  onSuccess: (r) => toast.success(r.created ? `${r.created} frase(s) copiada(s).` : 'Nada novo para copiar.'),
                  onError: errToast,
                })
              }
            >
              Aplicar frases padrão
            </Button>
          )}
          <Button onClick={() => setEditing({ priority: 'MEDIUM' })}>Nova frase</Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Frase</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Prioridade</th>
              <th className="px-3 py-2 font-medium">Situação</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {phrases?.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <div>{p.phrase}</div>
                  {p.title && <div className="text-xs text-muted-foreground">Título: {p.title}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{catName(p.categoryId)}</td>
                <td className="px-3 py-2">{PRIORITY_LABELS[p.priority]}</td>
                <td className="px-3 py-2">
                  <Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'Ativa' : 'Inativa'}</Badge>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-3">
                    <button type="button" className="text-primary hover:underline" onClick={() => setEditing(p)}>
                      Editar
                    </button>
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => save.mutate({ id: p.id, phrase: p.phrase, active: !p.active }, { onError: errToast })}
                    >
                      {p.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => {
                        if (confirm(`Apagar a frase "${p.phrase}"?`)) remove.mutate(p.id, { onError: errToast });
                      }}
                    >
                      Apagar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {phrases && phrases.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma frase cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar frase' : 'Nova frase'}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-phrase">Frase</Label>
            <Input
              id="ph-phrase"
              placeholder="Sistema caiu"
              value={editing?.phrase ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, phrase: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-title">Título do chamado (opcional)</Label>
            <Input
              id="ph-title"
              placeholder="Usa a própria frase se ficar vazio"
              value={editing?.title ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, title: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-cat">Categoria</Label>
            <Select
              id="ph-cat"
              value={editing?.categoryId ?? ''}
              onChange={(e) => setEditing((v) => ({ ...v, categoryId: e.target.value || null }))}
            >
              <option value="">Sem categoria</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-prio">Prioridade</Label>
            <Select
              id="ph-prio"
              value={editing?.priority ?? 'MEDIUM'}
              onChange={(e) => setEditing((v) => ({ ...v, priority: e.target.value as TicketPriority }))}
            >
              {(Object.keys(PRIORITY_LABELS) as TicketPriority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              Salvar
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
