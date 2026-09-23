'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useArticle, useUpdateArticle } from '@/lib/knowledge';
import { downloadAttachment, type Attachment } from '@/lib/tickets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

function onErr(e: unknown) {
  toast.error(e instanceof ApiError ? e.message : 'Falha na operação.');
}

export default function ArticleDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: article, isLoading, isError } = useArticle(id);
  const update = useUpdateArticle(id);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });
  const { data: attachments } = useQuery({
    queryKey: ['article-attachments', id],
    queryFn: () => api<Attachment[]>(`/knowledge-articles/${id}/attachments`),
    enabled: !!id,
  });

  useEffect(() => {
    if (!article) return;
    setTitle(article.title);
    setBody(article.body);
  }, [article]);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api(`/knowledge-articles/${id}/attachments`, { method: 'POST', body: fd });
      qc.invalidateQueries({ queryKey: ['article-attachments', id] });
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Anexo enviado.');
    } catch (e) {
      onErr(e);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !article) return <p className="text-sm text-destructive-foreground">Artigo não encontrado.</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          className="flex-1 text-lg font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== article.title && update.mutate({ title: title.trim() }, { onError: onErr })}
        />
        <Badge tone={article.active ? 'green' : 'neutral'}>{article.active ? 'Ativo' : 'Inativo'}</Badge>
        <Button
          variant="outline"
          className="h-9"
          onClick={() => update.mutate({ active: !article.active }, { onError: onErr })}
        >
          {article.active ? 'Desativar' : 'Ativar'}
        </Button>
      </div>

      <textarea
        className="min-h-40 rounded-md border border-input bg-background p-2 text-sm"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={() => body.trim() && body !== article.body && update.mutate({ body: body.trim() }, { onError: onErr })}
      />

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Categoria</Label>
          <Select
            value={article.categoryId ?? ''}
            onChange={(e) => update.mutate({ categoryId: e.target.value }, { onError: onErr })}
          >
            <option value="">Nenhuma</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Tipo de ativo</Label>
          <Select
            value={article.assetTypeId ?? ''}
            onChange={(e) => update.mutate({ assetTypeId: e.target.value }, { onError: onErr })}
          >
            <option value="">Nenhum</option>
            {assetTypes?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Anexos</h2>
        <ul className="flex flex-col gap-1">
          {attachments?.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => downloadAttachment(a.id, a.filename).catch(() => toast.error('Falha no download.'))}
                className="text-sm text-primary hover:underline"
              >
                📎 {a.filename}
              </button>
            </li>
          ))}
        </ul>
        <input
          ref={fileRef}
          type="file"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
      </section>
    </div>
  );
}
