'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type SettingsView = Record<string, string | boolean>;

// Padrões = DEFAULT_THRESHOLDS de backend/src/agent/improvements.ts.
const FIELDS = [
  ['improvements.ramMinGb', 'RAM mínima recomendada (GB)', '8'],
  ['improvements.diskFreePct', 'Espaço livre mínimo no disco do sistema (%)', '15'],
  ['improvements.biosMaxYears', 'Idade máxima da BIOS (anos)', '5'],
  ['improvements.staleDays', 'Ignorar dispositivos sem contato há mais de (dias)', '7'],
] as const;

export default function ImprovementsTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<SettingsView>('/settings') });
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setF(Object.fromEntries(FIELDS.map(([k]) => [k, (data[k] as string) ?? ''])));
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const values: Record<string, string> = {};
      for (const [k, label] of FIELDS) {
        const v = (f[k] ?? '').trim();
        if (v !== '' && !(Number(v) > 0))
          throw new ApiError(400, { message: `${label}: informe um número maior que zero.` });
        values[k] = v;
      }
      return api('/settings', { method: 'PUT', body: { values } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['agent-improvements'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset-inventory'] });
      toast.success('Limiares salvos.');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha na operação.'),
  });

  return (
    <form
      className="flex max-w-lg flex-col gap-3 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2 className="text-sm font-semibold">Sugestões de melhoria</h2>
      <p className="text-sm text-muted-foreground">
        Campo vazio usa o valor padrão (mostrado como exemplo).
      </p>
      {FIELDS.map(([k, label, def]) => (
        <div key={k} className="flex items-center gap-3">
          <Label className="w-72">{label}</Label>
          <Input
            type="number"
            min={1}
            className="w-24"
            placeholder={def}
            value={f[k] ?? ''}
            onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))}
          />
        </div>
      ))}
      <div>
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
      </div>
    </form>
  );
}
