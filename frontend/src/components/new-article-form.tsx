'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useCreateArticle } from '@/lib/knowledge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

export function NewArticleForm({ onCreated }: { onCreated: (articleId: string) => void }) {
  const create = useCreateArticle();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });

  function submit() {
    if (!title.trim() || !body.trim()) {
      toast.error('Preencha título e corpo.');
      return;
    }
    create.mutate(
      { title: title.trim(), body: body.trim(), categoryId: categoryId || undefined, assetTypeId: assetTypeId || undefined },
      {
        onSuccess: (created) => {
          toast.success('Artigo criado.');
          onCreated(created.id);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao criar artigo.'),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Título</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Corpo</Label>
        <textarea
          className="min-h-40 rounded-md border border-input bg-background p-2 text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Categoria</Label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Nenhuma</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Tipo de ativo</Label>
          <Select value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)}>
            <option value="">Nenhum</option>
            {assetTypes?.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      </div>
      <Button className="h-9 w-fit" disabled={create.isPending} onClick={submit}>
        Criar artigo
      </Button>
    </div>
  );
}
