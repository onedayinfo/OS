'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
    <section>
      <h2 className="mb-2 text-sm font-semibold">Artigos relacionados</h2>
      <ul className="flex flex-col gap-1">
        {data.map((a) => (
          <li key={a.id}>
            <Link href={`/app/base-conhecimento/${a.id}`} className="text-sm text-primary hover:underline">
              📄 {a.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
