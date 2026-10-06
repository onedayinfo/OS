import type { TicketDetail } from '@/lib/tickets';

export function TicketSatisfaction({ ticket }: { ticket: TicketDetail }) {
  const survey = ticket.satisfactionSurvey;
  if (!survey) return null;

  return (
    <section className="rounded-xl bg-card p-5 shadow-sm">
      <h2 className="mb-3 text-[14px] font-semibold">Satisfação</h2>
      {survey.respondedAt ? (
        <div className="rounded-lg bg-muted p-3 text-[13px]">
          <p className="font-semibold">Nota {survey.score}/5</p>
          {survey.comment && <p className="mt-1 text-muted-foreground">{survey.comment}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Aguardando resposta do cliente.</p>
      )}
    </section>
  );
}
