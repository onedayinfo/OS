import type { TicketDetail } from '@/lib/tickets';

export function TicketSatisfaction({ ticket }: { ticket: TicketDetail }) {
  const survey = ticket.satisfactionSurvey;
  if (!survey) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">Satisfação</h2>
      {survey.respondedAt ? (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">⭐ {survey.score}/5</p>
          {survey.comment && <p className="mt-1 text-muted-foreground">{survey.comment}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aguardando resposta do cliente.</p>
      )}
    </section>
  );
}
