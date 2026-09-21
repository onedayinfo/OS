# CSAT pós-chamado (Fase 0.7.0 — parte 1/4)

Data: 2026-09-20
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `4bb0b0f` (release 0.6.0 + deploy)
Roadmap: `docs/roadmap.md` — 0.7.0 "Gestão, SLA real e satisfação"

## 1. Objetivo

Medir satisfação do cliente por chamado: ao fechar um chamado, o sistema
manda um e-mail com link público (sem login) pedindo uma nota de 1 a 5 e um
comentário opcional. A resposta aparece na ficha do chamado.

A fase 0.7.0 do roadmap junta 4 partes pouco acopladas entre si (Dashboard,
SLA real, CSAT/NPS, Base de conhecimento) — **esta spec cobre só o CSAT**,
decisão explícita do usuário de tratar cada parte como sua própria sessão
de brainstorm→spec→plano→execução. As demais três ficam para sessões
futuras.

Entregas:

1. **Pesquisa CSAT** (nota 1–5 + comentário opcional) criada automaticamente
   quando um chamado fecha (`status → CLOSED`), desde que tenha solicitante.
2. **E-mail** pro solicitante com link público de resposta.
3. **Página pública** de resposta, sem login, com proteção contra reenvio
   (token só aceita uma resposta).
4. **Bloco "Satisfação"** na ficha do chamado mostrando nota/comentário, ou
   "aguardando resposta", ou nada (se não houve solicitante).

Fora de escopo (adiado): NPS de verdade (pergunta de recomendação
periódica, não por chamado); relatório agregado/médias/gráficos (fica pro
Dashboard, próxima sessão da 0.7.0); reenvio manual de pesquisa; pesquisa
pra todos os contatos do cliente (só o solicitante); disparo em `RESOLVED`
(só em `CLOSED`).

## 2. Decisões travadas (do brainstorm)

- **Só CSAT (1–5), sem NPS separado** nesta fase — uma pergunta só, menos
  fricção pro cliente responder.
- **Dispara em `CLOSED`**, não em `RESOLVED` — só pergunta satisfação
  quando o chamado realmente terminou.
- **Uma pesquisa por chamado, sempre** — `TicketSatisfactionSurvey.ticketId`
  é `@unique`. Se o chamado reabrir e fechar de novo, não gera segunda
  pesquisa nem manda segundo e-mail; a pesquisa (respondida ou não) da
  primeira vez continua valendo e visível.
- **Só o solicitante** (`ticket.requesterId`) recebe o e-mail. Sem
  solicitante → nenhuma pesquisa é criada, sem erro.
- **Sem tela de relatório agregado nesta fase** — só o bloco na ficha do
  próprio chamado. Agregação/médias/filtro por técnico fica pro Dashboard.
- **Token público segue o padrão do `Quote`**: `randomBytes(24).toString('hex')`,
  campo único, sem hash (mesmo nível de proteção do link de orçamento).

## 3. Arquitetura

### 3.1 Schema Prisma

```prisma
model TicketSatisfactionSurvey {
  id          String    @id @default(cuid())
  ticketId    String    @unique
  publicToken String    @unique
  score       Int?
  comment     String?
  sentAt      DateTime  @default(now())
  respondedAt DateTime?

  ticket Ticket @relation(fields: [ticketId], references: [id])

  @@map("ticket_satisfaction_surveys")
}
```

`Ticket` ganha a relação reversa `satisfactionSurvey TicketSatisfactionSurvey?`.

### 3.2 Backend — módulo `surveys`

```
backend/src/
  surveys/
    surveys.module.ts
    surveys.service.ts          # create (interno, sem rota) + findByToken + respond
    surveys-public.controller.ts  # @Public(): GET/POST por token
    dto/respond-survey.dto.ts
    surveys.service.spec.ts
```

`SurveysModule` exporta `SurveysService`; `TicketsModule` importa
`SurveysModule` (a criação da pesquisa acontece dentro de
`TicketsService.changeStatus`, chamando `SurveysService.createForTicket`).

### 3.3 Rotas

**surveys-public** (`@Public()`)
- `GET /public/surveys/:token` — devolve `{ ticketNumber, ticketTitle,
  score, comment, respondedAt }`. `404` se token não existe.
- `POST /public/surveys/:token` — body `{ score: number (1-5), comment?:
  string }`. `409` se `respondedAt` já preenchido (idempotente). `400` se
  `score` fora de 1–5.

**tickets** (módulo existente, alterado)
- `TicketsService.changeStatus`: no branch `next === 'CLOSED'`, depois de
  gravar `closedAt` e o evento `STATUS_CHANGED`, chama
  `this.surveys.createForTicket(tx, updated)`. Sem solicitante ou já existe
  survey pro ticket → não faz nada (idempotente via `@unique` +
  `findUnique` antes de criar).
- `TicketsService.findOne`: inclui `satisfactionSurvey: { select: { score,
  comment, respondedAt } }` (sem expor `publicToken` pra quem vê o chamado
  autenticado).

### 3.4 Criação da pesquisa (`SurveysService.createForTicket`)

```ts
async createForTicket(tx: Prisma.TransactionClient, ticket: Ticket): Promise<void> {
  if (!ticket.requesterId) return;
  const existing = await tx.ticketSatisfactionSurvey.findUnique({ where: { ticketId: ticket.id } });
  if (existing) return;
  const survey = await tx.ticketSatisfactionSurvey.create({
    data: { ticketId: ticket.id, publicToken: randomBytes(24).toString('hex') },
  });
  // notificação é best-effort, fora da transação de escrita do ticket —
  // ver 3.5, chamado depois do commit pelo TicketsService (mesmo padrão
  // já usado pra `notifier.resolved(...)`).
}
```

A criação do registro roda **dentro** da mesma transação do
`changeStatus` (consistência: se o `update` do ticket falhar, a survey não
fica órfã). O envio do e-mail roda **depois** do commit, via
`notifier.surveyRequested(ticket, survey)`, no mesmo bloco try/catch
não-bloqueante que já envolve `notifier.resolved(...)` hoje.

### 3.5 `TicketNotifier` — método novo

```ts
export interface TicketNotifier {
  created(ticket: Ticket): Promise<void>;
  resolved(ticket: Ticket): Promise<void>;
  assigned(ticket: Ticket): Promise<void>;
  publicComment(ticket: Ticket, comment: TicketComment): Promise<void>;
  slaBreached(ticket: Ticket): Promise<void>;
  surveyRequested(ticket: Ticket, survey: TicketSatisfactionSurvey): Promise<void>;
}
```

`NotificationsService.surveyRequested`: busca o `requester` (User) pelo
`ticket.requesterId` — sempre `type: 'CLIENT'`, já que é quem abre/acompanha
chamado pelo portal ou é vinculado na criação manual — monta o link
`${process.env.PORTAL_URL}/pesquisa/{token}` (mesma env já usada em
`UsersService` pra link de definição de senha de contato CLIENT), chama
`email.send(...)` com o template novo.

### 3.6 Template de e-mail

`email/templates.ts` ganha `satisfactionSurvey(ticket, link, brand?)`,
mesmo padrão de `wrap()`/`escapeHtml` dos demais: assunto
`"Como foi o atendimento do chamado #{ticket.number}?"`, corpo com o
título do chamado e o link de resposta.

### 3.7 Frontend

**Página pública** `frontend/src/app/pesquisa/[token]/page.tsx` — fora de
`/app`/`/portal`, clone do padrão de `orcamento/[token]/page.tsx`:
- `GET /public/surveys/:token` via `fetch` direto (sem `api()` do painel,
  sem sessão).
- Se `respondedAt` já setado → mostra "Você já respondeu essa pesquisa,
  obrigado!".
- Senão → formulário com 5 botões (1 a 5) + `<textarea>` opcional pro
  comentário + botão "Enviar". `POST` com `{score, comment}`; trata `409`
  como "já respondida" (idempotência, igual ao público de orçamento).

**Bloco na ficha do chamado** (`/app/chamados/[id]/page.tsx`): novo
componente `TicketSatisfaction`, mesmo lugar dos outros blocos
(`VisitsBlock`, `TicketMaterialUsages`, `TicketQuotes`):
- `ticket.satisfactionSurvey` ausente → não renderiza nada.
- `respondedAt` ausente → "Aguardando resposta do cliente".
- `respondedAt` presente → nota (ex.: "⭐ 4/5") + comentário se houver.

### 3.8 Migração

Prisma migrate: tabela nova `ticket_satisfaction_surveys`. Sem alteração em
enum, sem backfill (chamados já fechados antes desta fase não ganham
pesquisa retroativa).

## 4. Fluxos

### 4.1 Fechamento com solicitante
ADMIN/AGENT muda status pra `CLOSED` → survey criada → e-mail enviado pro
solicitante com o link.

### 4.2 Resposta
Cliente abre o link, escolhe uma nota de 1 a 5, opcionalmente escreve um
comentário, envia → `respondedAt` gravado → ficha do chamado passa a
mostrar a nota.

### 4.3 Reabertura
Chamado reaberto (`CLOSED→OPEN`) e fechado de novo → survey já existe,
nada novo é criado nem enviado; o bloco na ficha continua mostrando a
pesquisa original (respondida ou "aguardando").

### 4.4 Sem solicitante
Chamado fecha sem `requesterId` (raro, mas possível em fluxos internos) →
nenhuma pesquisa, nenhum e-mail, bloco não aparece.

## 5. Erros e bordas

- `POST /public/surveys/:token` com `score` fora de 1–5 → `400`.
- Token inexistente → `404` (sem distinguir formato inválido de "nunca
  existiu").
- Responder token já respondido → `409` idempotente, front trata como
  "já respondida", não como erro genérico.
- Falha no envio do e-mail (Resend fora do ar) → loga warn, não propaga
  erro, não desfaz a criação do registro (mesmo padrão dos demais
  notifiers do sistema — ex. aviso de contrato vencendo).
- Reabertura não mexe no registro existente — nem limpa `score`/`comment`
  se já respondida antes da reabertura.

## 6. Testes

Unit (Vitest):
- `SurveysService.createForTicket` — cria com solicitante; não cria sem
  solicitante; não duplica se já existe (idempotente).
- `SurveysService.respond` — grava `score`/`comment`/`respondedAt`;
  rejeita `score` fora de 1–5; rejeita responder duas vezes (`409`).
- `SurveysService.findByToken` — `404` pra token inexistente.
- `TicketsService.changeStatus` — fechar chamado com solicitante dispara
  `surveys.createForTicket` e `notifier.surveyRequested`; fechar sem
  solicitante não dispara nada; reabrir e fechar de novo não duplica.
- `NotificationsService.surveyRequested` — monta o e-mail certo, não lança
  se o envio falhar.

Integração (Postgres real): fechar chamado com solicitante real → survey
criada com token → responder via `SurveysService.respond` → `respondedAt`
gravado → reabrir e fechar de novo não cria segunda survey.

E2E Playwright (fumaça): fechar chamado no `/app` → pegar o token direto
do banco (ou expor temporariamente na UI de teste) → responder a pesquisa
na página pública → conferir que a ficha do chamado mostra a nota.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma (`TicketSatisfactionSurvey`) + migração.
2. `SurveysService` — `createForTicket` + testes.
3. `SurveysService` — `respond` + `findByToken` + testes.
4. `surveys-public.controller` + `surveys.module` + registro no
   `app.module.ts`.
5. `TicketNotifier` — método `surveyRequested` + template de e-mail.
6. `TicketsService.changeStatus` — hook de criação da survey no branch
   `CLOSED` + inclusão em `findOne` + testes.
7. Integração + CHANGELOG.
8. Frontend: `lib/surveys.ts` (tipos + hooks) + página pública
   `/pesquisa/[token]`.
9. Frontend: bloco "Satisfação" na ficha do chamado.
10. E2E + release 0.7.0 (parte 1/4).

## 8. Versão

MINOR → **0.7.0** (primeira entrega da fase; as outras 3 partes do
roadmap — Dashboard, SLA real, Base de conhecimento — vêm em sessões
seguintes, cada uma com seu próprio ciclo). Nenhuma env nova.
