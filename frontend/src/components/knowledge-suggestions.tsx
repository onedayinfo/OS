'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/icon';

interface Suggestion {
  id: string;
  title: string;
}

export function KnowledgeSuggestions({ ticketId }: { ticketId: string }) {
  const { data } = useQuery({
    queryKey: ['knowledge-suggestions', ticketId],
    queryFn: () => api<Suggestion[]>(`/knowledge-articles/suggestions?ticketId=${ticketId}`),
  });

  if (!data || data.length === 0) return null;

  return (
    <section className="rounded-xl bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-semibold">Artigos relacionados</h2>
      <ul className="flex flex-col gap-1">
        {data.map((a) => (
          <li key={a.id}>
            <Link href={`/app/base-conhecimento/${a.id}`} className="flex items-center gap-1.5 text-[13px] text-primary hover:underline">
              <Icon name="article" className="text-[18px]" />
              {a.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
