'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface KnowledgeArticleSummary {
  id: string;
  title: string;
  active: boolean;
  category: { id: string; name: string } | null;
  assetType: { id: string; name: string } | null;
}

export interface ArticleFilters {
  q?: string;
  categoryId?: string;
  assetTypeId?: string;
}

function toQuery(f: ArticleFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.categoryId) p.set('categoryId', f.categoryId);
  if (f.assetTypeId) p.set('assetTypeId', f.assetTypeId);
  return p.toString();
}

export function useArticles(filter: ArticleFilters) {
  return useQuery({
    queryKey: ['knowledge-articles', filter],
    queryFn: () => api<KnowledgeArticleSummary[]>(`/knowledge-articles?${toQuery(filter)}`),
  });
}

export interface CreateArticleInput {
  title: string;
  body: string;
  categoryId?: string;
  assetTypeId?: string;
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArticleInput) =>
      api<{ id: string }>('/knowledge-articles', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-articles'] }),
  });
}

export interface KnowledgeArticleDetail {
  id: string;
  title: string;
  body: string;
  active: boolean;
  categoryId: string | null;
  assetTypeId: string | null;
  category: { id: string; name: string } | null;
  assetType: { id: string; name: string } | null;
}

export function useArticle(id: string) {
  return useQuery({
    queryKey: ['knowledge-article', id],
    queryFn: () => api<KnowledgeArticleDetail>(`/knowledge-articles/${id}`),
    enabled: !!id,
  });
}

export interface UpdateArticleInput {
  title?: string;
  body?: string;
  categoryId?: string;
  assetTypeId?: string;
  active?: boolean;
}

export function useUpdateArticle(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateArticleInput) =>
      api<KnowledgeArticleDetail>(`/knowledge-articles/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-article', id] });
      qc.invalidateQueries({ queryKey: ['knowledge-articles'] });
    },
  });
}
