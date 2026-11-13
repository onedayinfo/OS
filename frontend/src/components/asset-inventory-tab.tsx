'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SEVERITY_LABELS,
  SEVERITY_TONE,
  relativeTime,
  useAssetInventory,
  type InventoryDisk,
  type SoftwareItem,
  type Suggestion,
} from '@/lib/improvements';

const PAGE = 50;

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
      <h3 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

const yn = (v: boolean | undefined, yes: string, no: string) => (v === undefined ? '—' : v ? yes : no);

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v ?? '—'}</span>
    </div>
  );
}

function Disk({ d }: { d: InventoryDisk }) {
  const usedPct =
    d.tamanhoGb && d.livreGb != null
      ? Math.min(100, Math.max(0, Math.round(((d.tamanhoGb - d.livreGb) / d.tamanhoGb) * 100)))
      : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="font-medium">{d.nome ?? 'Disco'}</span>
        {d.sistema && <Badge tone="neutral">Sistema</Badge>}
        {d.tipo && <Badge tone={d.tipo === 'SSD' ? 'green' : 'amber'}>{d.tipo}</Badge>}
        {d.smart && (
          <Badge tone={d.smart === 'OK' ? 'green' : d.smart === 'Falha' ? 'red' : 'amber'}>
            SMART {d.smart}
          </Badge>
        )}
      </div>
      {usedPct !== null ? (
        <>
          <div className="h-2 overflow-hidden rounded bg-muted">
            <div
              className={`h-full ${usedPct >= 90 ? 'bg-destructive-foreground' : usedPct >= 75 ? 'bg-warning-foreground' : 'bg-primary'}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {usedPct}% usado · {d.livreGb} GB livres de {d.tamanhoGb} GB
          </span>
        </>
      ) : (
        d.tamanhoGb != null && <span className="text-xs text-muted-foreground">{d.tamanhoGb} GB</span>
      )}
    </div>
  );
}

export function SuggestionList({ items }: { items: Suggestion[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((s, i) => (
        <li key={`${s.rule}-${i}`} className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Badge tone={SEVERITY_TONE[s.severity]}>{SEVERITY_LABELS[s.severity]}</Badge>
            {s.title}
          </div>
          <p className="text-sm text-muted-foreground">{s.detail}</p>
        </li>
      ))}
    </ul>
  );
}

type SortKey = 'name' | 'version' | 'publisher';

function SoftwareTable({ software }: { software: SoftwareItem[] }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t
      ? software.filter((s) => `${s.name} ${s.publisher ?? ''}`.toLowerCase().includes(t))
      : [...software];
    f.sort((a, b) => (a[sort] ?? '').localeCompare(b[sort] ?? '', 'pt-BR', { numeric: true }) * (asc ? 1 : -1));
    return f;
  }, [software, q, sort, asc]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const th = (k: SortKey, label: string) => (
    <th className="px-3 py-2 font-medium">
      <button
        type="button"
        className="uppercase hover:text-foreground"
        onClick={() => {
          if (sort === k) setAsc(!asc);
          else {
            setSort(k);
            setAsc(true);
          }
          setPage(0);
        }}
      >
        {label} {sort === k ? (asc ? '▲' : '▼') : ''}
      </button>
    </th>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Software instalado ({software.length})</h2>
        <Input
          placeholder="Buscar por nome ou fabricante"
          className="w-72"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {th('name', 'Nome')}
              {th('version', 'Versão')}
              {th('publisher', 'Fabricante')}
            </tr>
          </thead>
          <tbody>
            {rows.slice(cur * PAGE, (cur + 1) * PAGE).map((s, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-1.5">{s.name}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{s.version || '—'}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{s.publisher || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                  Nenhum software encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Button variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)}>
            Anterior
          </Button>
          <span className="text-muted-foreground">
            Página {cur + 1} de {pages}
          </span>
          <Button variant="outline" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>
            Próxima
          </Button>
        </div>
      )}
    </div>
  );
}

export function AssetInventoryTab({ assetId }: { assetId: string }) {
  const { data, isLoading, isError } = useAssetInventory(assetId);

  if (isLoading) return <p className="pt-4 text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !data)
    return <p className="pt-4 text-sm text-destructive-foreground">Falha ao carregar o inventário.</p>;
  if (!data.device)
    return <p className="pt-4 text-sm text-muted-foreground">Este ativo não tem agente instalado.</p>;

  const { device, software, suggestions } = data;
  const sp = data.specs ?? {};
  return (
    <div className="flex flex-col gap-4 pt-4">
      {suggestions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Melhorias sugeridas ({suggestions.length})</h2>
          <SuggestionList items={suggestions} />
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Último contato">
          <Row
            k="Visto"
            v={
              device.lastSeenAt
                ? `${relativeTime(device.lastSeenAt)} (${new Date(device.lastSeenAt).toLocaleString('pt-BR')})`
                : 'nunca'
            }
          />
          <Row k="Equipamento" v={device.hostname} />
          <Row k="Agente" v={device.agentVersion} />
          <Row k="IP" v={device.ip} />
          <Row k="MAC" v={device.mac} />
          <Row k="Primeiro contato" v={new Date(device.firstSeenAt).toLocaleDateString('pt-BR')} />
        </Card>
        <Card title="Processador e memória">
          <Row k="CPU" v={sp.cpu?.nome} />
          <Row k="Núcleos" v={sp.cpu?.nucleos} />
          <Row k="Memória RAM" v={sp.ramGb != null ? `${sp.ramGb} GB` : undefined} />
        </Card>
        <Card title="Sistema operacional">
          <Row k="Edição" v={sp.so?.edicao} />
          <Row k="Versão" v={sp.so?.versao} />
          <Row k="Build" v={sp.so?.build} />
        </Card>
        <Card title="BIOS e segurança">
          <Row k="BIOS" v={sp.bios?.versao} />
          <Row k="Data da BIOS" v={sp.bios?.data} />
          <Row
            k="TPM"
            v={
              sp.tpm
                ? sp.tpm.presente === false
                  ? 'Ausente'
                  : `Presente${sp.tpm.versao ? ` (${sp.tpm.versao})` : ''}`
                : undefined
            }
          />
          <Row k="Secure Boot" v={yn(sp.secureBoot, 'Ativo', 'Inativo')} />
          <Row k="UEFI" v={yn(sp.uefi, 'Sim', 'Não (legado)')} />
        </Card>
        <div className="md:col-span-2">
          <Card title="Discos">
            {sp.discos?.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {sp.discos.map((d, i) => (
                  <Disk key={i} d={d} />
                ))}
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </Card>
        </div>
      </div>

      <SoftwareTable software={software} />
    </div>
  );
}
