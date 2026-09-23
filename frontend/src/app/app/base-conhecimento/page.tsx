'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useArticles } from '@/lib/knowledge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Category { id: string; name: string }
interface AssetType { id: string; name: string }

export default function KnowledgeListPage() {
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assetTypeId, setAssetTypeId] = useState('');

  const { data: articles } = useArticles({ q: q || undefined, categoryId: categoryId || undefined, assetTypeId: assetTypeId || undefined });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const { data: assetTypes } = useQuery({ queryKey: ['asset-types'], queryFn: () => api<AssetType[]>('/asset-types') });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Base de conhecimento</h1>
        <Link href="/app/base-conhecimento/novo">
          <Button className="h-9">Novo artigo</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Buscar por título ou texto"
          className="h-9 w-64"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select className="h-9 w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select className="h-9 w-48" value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)}>
          <option value="">Todos os tipos de ativo</option>
          {assetTypes?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Categoria</th>
              <th className="px-3 py-2 font-medium">Tipo de ativo</th>
              <th className="px-3 py-2 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody>
            {articles?.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={`/app/base-conhecimento/${a.id}`} className="text-primary hover:underline">
                    {a.title}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{a.category?.name ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{a.assetType?.name ?? '—'}</td>
                <td className="px-3 py-2">
                  <Badge tone={a.active ? 'green' : 'neutral'}>{a.active ? 'Ativo' : 'Inativo'}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
