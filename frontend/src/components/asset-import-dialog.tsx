'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

interface PreviewRow {
  line: number;
  cliente: string;
  local: string;
  tipo: string;
  identificacao: string;
  numeroSerie: string;
  remoteId: string;
  error: string | null;
}

interface Pendencia {
  chave: string;
  tipo: 'cliente' | 'local' | 'tipo';
  nome: string;
  cliente?: string;
  linhas: number;
  sugestoes: string[];
  opcoes: { id: string; name: string }[];
}

interface ImportResult {
  created: number;
  errors: { line: number; message: string }[];
  rows?: PreviewRow[];
  pendencias?: Pendencia[];
}

// Escolhas por chave: 'criar' | 'ignorar' | 'id:<id>' (vazio = ainda não decidido).
type Choices = Record<string, string>;

const NOME = { cliente: 'Cliente', local: 'Local', tipo: 'Tipo' } as const;

export function AssetImportDialog() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [choices, setChoices] = useState<Choices>({});

  const send = (f: File, dryRun: boolean, ch: Choices) => {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('resolucoes', JSON.stringify(ch));
    return api<ImportResult>(`/assets/import${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body: fd,
    });
  };

  const previewFile = useMutation({
    mutationFn: ({ f, ch }: { f: File; ch: Choices }) => send(f, true, ch),
    onSuccess: (r, { f, ch }) => {
      setPreview(r);
      // local novo vem marcado para criar (barato e raramente erro de digitação); cliente e tipo, não
      const defaults = Object.fromEntries(
        (r.pendencias ?? []).filter((p) => p.tipo === 'local' && !(p.chave in ch)).map((p) => [p.chave, 'criar']),
      );
      if (Object.keys(defaults).length) decidir(f, { ...ch, ...defaults });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao ler a planilha.'),
  });

  // grava a escolha e revalida a planilha com ela (nada é gravado no banco até clicar em Importar)
  const decidir = (f: File, next: Choices) => {
    setChoices(next);
    previewFile.mutate({ f, ch: next });
  };

  const importFile = useMutation({
    mutationFn: (f: File) => send(f, false, choices),
    onSuccess: (r) => {
      setPreview(null);
      setResult(r);
      qc.invalidateQueries({ queryKey: ['assets'] });
      toast.success(`${r.created} ativo(s) importado(s).`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Falha ao importar a planilha.'),
  });

  return (
    <div className="flex flex-col gap-3">
      <a href="/modelo-ativos.xlsx" download className="text-sm text-primary hover:underline">
        Baixar modelo
      </a>
      <p className="text-xs text-muted-foreground">
        Colunas obrigatórias: cliente, local, tipo, identificacao. As demais são opcionais
        (marca, modelo, numero_serie, ip, mac, id_rustdesk, instalado_em, garantia_ate, observacoes).
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setResult(null);
          setPreview(null);
          setChoices({});
          if (f) previewFile.mutate({ f, ch: {} });
        }}
      />

      {previewFile.isPending && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}

      {file && !!preview?.pendencias?.length && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm">
          <p className="text-sm font-medium">Não encontrados no cadastro — o que fazer?</p>
          {preview.pendencias.map((p) => {
            const opcoes = [...p.opcoes].sort(
              (a, b) => Number(p.sugestoes.includes(b.id)) - Number(p.sugestoes.includes(a.id)),
            );
            return (
              <div key={p.chave} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <span className="text-sm sm:w-1/2">
                  {NOME[p.tipo]} <strong>{p.nome}</strong>
                  {p.cliente && <span className="text-muted-foreground"> ({p.cliente})</span>}
                  <span className="text-muted-foreground"> — {p.linhas} linha(s)</span>
                </span>
                <Select
                  className="sm:w-1/2"
                  value={choices[p.chave] ?? ''}
                  onChange={(e) => decidir(file, { ...choices, [p.chave]: e.target.value })}
                >
                  <option value="">Escolher…</option>
                  <option value="criar">Criar {NOME[p.tipo].toLowerCase()} novo</option>
                  {opcoes.map((o) => (
                    <option key={o.id} value={`id:${o.id}`}>
                      Vincular a: {o.name}
                      {p.sugestoes.includes(o.id) ? ' (parecido)' : ''}
                    </option>
                  ))}
                  <option value="ignorar">Ignorar essas linhas</option>
                </Select>
              </div>
            );
          })}
        </div>
      )}

      {preview?.rows && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {preview.created} pronto(s) para importar, {preview.errors.length} com erro (não serão
            importados).
          </p>
          <div className="max-h-80 overflow-auto rounded-lg border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Linha</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Local</th>
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Identificação</th>
                  <th className="px-3 py-2 font-medium">Nº série</th>
                  <th className="px-3 py-2 font-medium">ID RustDesk</th>
                  <th className="px-3 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-border">
                    <td className="px-3 py-2 text-muted-foreground">{r.line}</td>
                    <td className="px-3 py-2">{r.cliente}</td>
                    <td className="px-3 py-2">{r.local}</td>
                    <td className="px-3 py-2">{r.tipo}</td>
                    <td className="px-3 py-2">{r.identificacao}</td>
                    <td className="px-3 py-2">{r.numeroSerie}</td>
                    <td className="px-3 py-2">{r.remoteId}</td>
                    <td
                      className={`px-3 py-2 ${r.error ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {r.error ?? 'OK'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <Button
          type="button"
          disabled={!file || !preview || preview.created === 0 || importFile.isPending}
          onClick={() => file && importFile.mutate(file)}
        >
          {importFile.isPending ? 'Importando…' : preview ? `Importar ${preview.created}` : 'Importar'}
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{result.created} criados</p>
          {result.errors.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Linha</th>
                    <th className="px-3 py-2 font-medium">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((err, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground">{err.line}</td>
                      <td className="px-3 py-2">{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
