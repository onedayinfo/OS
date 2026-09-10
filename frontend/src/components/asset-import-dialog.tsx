'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface ImportResult {
  created: number;
  errors: { line: number; message: string }[];
}

export function AssetImportDialog({ onClose }: { onClose?: () => void }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const importCsv = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api<ImportResult>('/assets/import', { method: 'POST', body: fd });
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ['assets'] });
      toast.success(`${r.created} ativo(s) importado(s).`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'Falha ao importar o CSV.'),
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Importar ativos por CSV</h2>
        {onClose && (
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={onClose}
          >
            Fechar
          </button>
        )}
      </div>

      <a href="/modelo-ativos.csv" download className="text-sm text-primary hover:underline">
        Baixar modelo
      </a>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="text-sm"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setResult(null);
        }}
      />

      <div>
        <Button
          type="button"
          disabled={!file || importCsv.isPending}
          onClick={() => file && importCsv.mutate(file)}
        >
          {importCsv.isPending ? 'Importando…' : 'Importar'}
        </Button>
      </div>

      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{result.created} criados</p>
          {result.errors.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
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
