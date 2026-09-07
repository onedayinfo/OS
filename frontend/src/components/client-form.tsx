'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ClientValues {
  name: string;
  cnpj: string;
  emailDomains: string[];
  notes: string;
}

const EMPTY: ClientValues = { name: '', cnpj: '', emailDomains: [], notes: '' };

export function ClientForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ClientValues>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: ClientValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? EMPTY.name);
  const [cnpj, setCnpj] = useState(initial?.cnpj ?? EMPTY.cnpj);
  const [domains, setDomains] = useState((initial?.emailDomains ?? []).join(', '));
  const [notes, setNotes] = useState(initial?.notes ?? EMPTY.notes);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({
          name: name.trim(),
          cnpj: cnpj.trim(),
          emailDomains: domains
            .split(/[\s,]+/)
            .map((d) => d.trim())
            .filter(Boolean),
          notes: notes.trim(),
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="c-name">Nome</Label>
        <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="c-cnpj">CNPJ</Label>
        <Input id="c-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="c-dom">Domínios de e-mail (separados por vírgula)</Label>
        <Input
          id="c-dom"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          placeholder="acme.com, acme.com.br"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="c-notes">Notas</Label>
        <Textarea id="c-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
