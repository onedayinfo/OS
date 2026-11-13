'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { SuggestionList } from '@/components/asset-inventory-tab';
import { RULE_LABELS, useImprovements } from '@/lib/improvements';

export default function ImprovementsPage() {
  const { data, isLoading } = useImprovements();
  const [rule, setRule] = useState('');

  const clients = (data?.clients ?? [])
    .map((c) => ({
      ...c,
      items: c.items.filter((i) => !rule || i.suggestions.some((s) => s.rule === rule)),
    }))
    .filter((c) => c.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Melhorias sugeridas</h1>
        <Link href="/app/ativos" className="text-sm text-primary hover:underline">
          Voltar aos ativos
        </Link>
      </div>
      <Select className="w-64" value={rule} onChange={(e) => setRule(e.target.value)}>
        <option value="">Todas as regras</option>
        {Object.entries(RULE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {data && clients.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma melhoria sugerida.</p>
      )}
      {clients.map((c) => (
        <section
          key={c.clientId}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{c.clientName}</h2>
            <Badge tone="neutral">
              {c.items.length} {c.items.length === 1 ? 'ativo' : 'ativos'}
            </Badge>
            {Object.entries(c.byRule).map(([r, n]) => (
              <Badge key={r} tone="blue">
                {RULE_LABELS[r] ?? r}: {n}
              </Badge>
            ))}
          </div>
          <ul className="flex flex-col gap-3">
            {c.items.map((i) => (
              <li key={i.assetId} className="flex flex-col gap-1">
                <Link
                  href={`/app/ativos/${i.assetId}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {i.label}
                </Link>
                <SuggestionList
                  items={rule ? i.suggestions.filter((s) => s.rule === rule) : i.suggestions}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
