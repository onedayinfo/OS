'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PublicSurvey } from '@/lib/surveys';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: survey, isLoading } = useQuery({
    queryKey: ['public-survey', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/public/surveys/${token}`);
      if (!res.ok) throw new Error('Pesquisa não encontrada.');
      return (await res.json()) as PublicSurvey;
    },
  });

  async function submit() {
    if (!score) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/public/surveys/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment || undefined }),
      });
      if (res.status === 409) {
        setErrorMsg('Você já respondeu essa pesquisa.');
        return;
      }
      if (!res.ok) {
        setErrorMsg('Não foi possível enviar. Tente novamente.');
        return;
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!survey) return <p className="p-6 text-sm text-muted-foreground">Pesquisa não encontrada.</p>;

  const alreadyResponded = submitted || !!survey.respondedAt;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">Chamado {survey.ticketNumber}</h1>
      <p className="text-sm text-muted-foreground">{survey.ticketTitle}</p>

      {alreadyResponded ? (
        <p className="text-sm">
          {submitted ? 'Obrigado pela resposta!' : 'Você já respondeu essa pesquisa, obrigado!'}
        </p>
      ) : (
        <>
          <p className="text-sm">Como você avalia o atendimento?</p>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(n)}
                className={`h-10 w-10 rounded-md border text-sm font-medium ${score === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Comentário (opcional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {errorMsg && <p className="text-sm text-destructive-foreground">{errorMsg}</p>}
          <Button className="w-fit" disabled={!score || submitting} onClick={submit}>
            Enviar
          </Button>
        </>
      )}
    </div>
  );
}
