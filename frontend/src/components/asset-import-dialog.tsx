'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';

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

interface ImportResult {
  created: number;
  errors: { line: number; message: string }[];
  rows?: PreviewRow[];
}

export function AssetImportDialog() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const send = (f: File, dryRun: boolean) => {
    const fd = new FormData();
    fd.append('file', f);
    return api<ImportResult>(`/assets/import${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      body: fd,
    });
  };

  const previewCsv = useMutation({
    mutationFn: (f: File) => send(f, true),
    onSuccess: setPreview,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao ler o CSV.'),
  });

  const importCsv = useMutation({
    mutationFn: (f: File) => send(f, false),
    onSuccess: (r) => {
      setPreview(null);
      setResult(r);
      qc.invalidateQueries({ queryKey: ['assets'] });
      toast.success(`${r.created} ativo(s) importado(s).`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Falha ao importar o CSV.'),
  });

  return (
    <div className="flex flex-col gap-3">
      <a href="/modelo-ativos.csv" download className="text-sm text-primary hover:underline">
        Baixar modelo
      </a>
      <p className="text-xs text-muted-foreground">
        Colunas obrigatórias: cliente, local, tipo, identificacao. As demais são opcionais
        (marca, modelo, numero_serie, ip, mac, id_rustdesk, instalado_em, garantia_ate, observacoes).
      </p>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="text-sm"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          setResult(null);
          setPreview(null);
          if (f) previewCsv.mutate(f);
        }}
      />

      {previewCsv.isPending && <p className="text-sm text-muted-foreground">Lendo o arquivo…</p>}

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
          disabled={!file || !preview || preview.created === 0 || importCsv.isPending}
          onClick={() => file && importCsv.mutate(file)}
        >
          {importCsv.isPending ? 'Importando…' : preview ? `Importar ${preview.created}` : 'Importar'}
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
