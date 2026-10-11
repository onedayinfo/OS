'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { useCreateGroup, useGroups, useRemoveGroup, useUpdateGroup } from '@/lib/whatsapp';
import { TriggerPhrasesPanel } from '@/components/trigger-phrases-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const errToast = (e: unknown) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');

export function WhatsappClientTab({ clientId }: { clientId: string }) {
  const { data: groups } = useGroups(clientId);
  const create = useCreateGroup(clientId);
  const update = useUpdateGroup(clientId);
  const remove = useRemoveGroup(clientId);
  const [externalId, setExternalId] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="flex flex-col gap-8 pt-4">
      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Grupos do cliente</h2>
        <p className="text-sm text-muted-foreground">
          Cole o <b>ID do grupo</b> (algo como <code>120363000000000001@g.us</code>) copiado da Evolution. Só
          os grupos cadastrados aqui são lidos; qualquer pessoa do grupo conta, conhecida ou não.
        </p>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!externalId.trim()) return;
            create.mutate(
              { externalId, name: name || undefined },
              {
                onSuccess: () => {
                  setExternalId('');
                  setName('');
                  toast.success('Grupo cadastrado.');
                },
                onError: errToast,
              },
            );
          }}
        >
          <div className="flex min-w-[260px] flex-1 flex-col gap-1.5">
            <Label htmlFor="wg-id">ID do grupo</Label>
            <Input id="wg-id" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
          </div>
          <div className="flex min-w-[180px] flex-col gap-1.5">
            <Label htmlFor="wg-name">Apelido (opcional)</Label>
            <Input id="wg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" disabled={create.isPending}>
            Adicionar grupo
          </Button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Apelido</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Situação</th>
                <th className="px-3 py-2 font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {groups?.map((g) => (
                <tr key={g.id} className="border-t border-border">
                  <td className="px-3 py-2">{g.name ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{g.externalId}</td>
                  <td className="px-3 py-2">
                    <Badge tone={g.active ? 'green' : 'neutral'}>{g.active ? 'Lendo' : 'Pausado'}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => update.mutate({ id: g.id, active: !g.active }, { onError: errToast })}
                      >
                        {g.active ? 'Pausar' : 'Retomar'}
                      </button>
                      <button
                        type="button"
                        className="text-destructive hover:underline"
                        onClick={() => {
                          if (confirm('Remover o grupo apaga também as mensagens gravadas dele. Continuar?'))
                            remove.mutate(g.id, { onError: errToast });
                        }}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {groups && groups.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    Nenhum grupo cadastrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[14px] font-semibold">Frases de gatilho</h2>
        <TriggerPhrasesPanel clientId={clientId} />
      </section>
    </div>
  );
}
