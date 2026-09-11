# Agenda e Execução em Campo (Fase 0.4.0 — núcleo)

Data: 2026-09-10
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `9c15138` (release 0.3.0)
Roadmap: `docs/roadmap.md` — 0.4.0 "Agenda e execução em campo"

## 1. Objetivo

Dar ao chamado uma ou mais **visitas técnicas** agendadas, executadas em
campo com checklist, fotos, assinatura do cliente e apontamento de horas, e
fechadas com um **laudo em PDF** enviado automaticamente ao cliente.

Entregas:

1. **Agendamento de visita** vinculada ao chamado (janela de data/hora,
   técnico).
2. **Agenda por técnico/dia** — lista/tabela para o dispatcher.
3. **Check-in/check-out** no local, com geolocalização opcional.
4. **Checklist de visita** configurável por categoria de serviço, com fotos.
5. **Assinatura do cliente** (canvas → imagem).
6. **Apontamento de horas** derivado do check-in/out, editável.
7. **Laudo de atendimento em PDF**, enviado por e-mail ao fechar a visita.
8. **Front responsivo** para o técnico em campo (`/app/campo`), mesma app.

Fora de escopo (adiado para sessões futuras): ativos/locais no portal do
cliente; WhatsApp como canal; geofence/validação de proximidade no
check-in; calendário visual (drag-and-drop); detecção de conflito de
agenda entre visitas do mesmo técnico; offline.

## 2. Decisões travadas (do brainstorm)

- **Visita é 1:N com Chamado** — revisita/retorno usa uma nova `Visit` no
  mesmo chamado, não abre chamado novo.
- **Técnico da visita é independente do `assignee` do chamado** — campo
  próprio (`Visit.technicianId`, `User` com role `AGENT`); o dispatcher pode
  escalar um técnico diferente de quem está com o chamado.
- **Checklist configurável por categoria** — cadastro `ChecklistTemplate` +
  `ChecklistTemplateItem`, no molde de `AssetType`/`Category` (CRUD em
  `/app/config`). Uma visita usa o template da categoria do chamado; sem
  categoria ou sem template cadastrado, cai num único template padrão
  (`categoryId: null`) sempre existente (seed).
- **Apontamento de horas** deriva de `checkInAt`/`checkOutAt`
  (`laborStartAt`/`laborEndAt` preenchidos automaticamente), mas são campos
  próprios editáveis — corrige esquecimento de check-out ou lançamento
  manual.
- **Laudo em PDF é automático**: ao fechar a visita (`DONE`), gera o PDF e
  envia e-mail ao cliente. Fechar exige checklist completo e assinatura
  presente — senão a API recusa (`400`).
- **GPS é só registro, sem geofence**: captura `navigator.geolocation` no
  check-in/checkout se o navegador permitir; sem permissão, segue sem
  coordenadas. Nenhuma validação de proximidade.
- **Agenda é lista/tabela**, agrupada por técnico e dia — sem calendário
  visual nesta fase.
- **PDF gerado com `pdfkit`** (dependência nova, pura JS, sem Chromium) —
  evita inchar mais a imagem Docker do backend (já é item de backlog
  conhecido reduzir esse tamanho).
- **E-mail do laudo é um link**, não anexo binário — reaproveita
  `GET /attachments/:id` (autenticado, checa acesso ao chamado) em vez de
  estender `EmailService` com anexos. O PDF em si vira um `Attachment` da
  visita.
- **Fotos e assinatura reaproveitam `Attachment`** — sem tabela nova. Ganha
  `visitId?` e um enum `AttachmentKind` (`PHOTO_BEFORE`, `PHOTO_AFTER`,
  `SIGNATURE`, `REPORT`, `GENERIC`; anexos existentes = `GENERIC`).
- **Front mobile do técnico** é rota nova na mesma app Next.js
  (`/app/campo`), mesmo login/roles, responsiva — sem subdomínio/app
  separado.

## 3. Arquitetura

### 3.1 Schema Prisma

```prisma
enum VisitStatus {
  SCHEDULED
  IN_PROGRESS
  DONE
  CANCELLED
}

enum AttachmentKind {
  GENERIC
  PHOTO_BEFORE
  PHOTO_AFTER
  SIGNATURE
  REPORT
}

model ChecklistTemplate {
  id         String   @id @default(cuid())
  categoryId String?  @unique   // null = template padrão (fallback)
  name       String
  active     Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  category Category? @relation(fields: [categoryId], references: [id])
  items    ChecklistTemplateItem[]
  visits   Visit[]

  @@map("checklist_templates")
}

model ChecklistTemplateItem {
  id         String @id @default(cuid())
  templateId String
  label      String
  order      Int    @default(0)

  template ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  answers  VisitChecklistAnswer[]

  @@index([templateId])
  @@map("checklist_template_items")
}

model Visit {
  id             String      @id @default(cuid())
  ticketId       String
  technicianId   String
  checklistTemplateId String?
  status         VisitStatus @default(SCHEDULED)
  scheduledStart DateTime
  scheduledEnd   DateTime
  checkInAt      DateTime?
  checkInLat     Float?
  checkInLng     Float?
  checkOutAt     DateTime?
  checkOutLat    Float?
  checkOutLng    Float?
  laborStartAt   DateTime?
  laborEndAt     DateTime?
  notes          String?
  reportSentAt   DateTime?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  ticket            Ticket             @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  technician        User               @relation(fields: [technicianId], references: [id])
  checklistTemplate ChecklistTemplate? @relation(fields: [checklistTemplateId], references: [id])
  checklistAnswers  VisitChecklistAnswer[]
  attachments       Attachment[]

  @@index([ticketId])
  @@index([technicianId])
  @@map("visits")
}

model VisitChecklistAnswer {
  id      String  @id @default(cuid())
  visitId String
  itemId  String
  done    Boolean @default(false)
  note    String?

  visit Visit                 @relation(fields: [visitId], references: [id], onDelete: Cascade)
  item  ChecklistTemplateItem @relation(fields: [itemId], references: [id])

  @@unique([visitId, itemId])
  @@map("visit_checklist_answers")
}
```

Alterações em models existentes:
- `Attachment` ganha `visitId?` (FK, índice) e `kind AttachmentKind @default(GENERIC)`.
- `Ticket` ganha `visits Visit[]`.
- `TicketEventType` ganha `VISIT_SCHEDULED`, `VISIT_STARTED`, `VISIT_COMPLETED`,
  `VISIT_CANCELLED`.
- Seed: um `ChecklistTemplate` com `categoryId: null` ("Checklist padrão") e
  3-4 itens genéricos (energia ok, equipamento funcionando, local limpo,
  cliente orientado), no mesmo `onModuleInit` idempotente do `AssetType`.

### 3.2 Backend — módulos novos

```
backend/src/
  checklist-templates/
    checklist-templates.module.ts
    checklist-templates.service.ts   # CRUD + seed idempotente
    checklist-templates.controller.ts # GET (ADMIN,AGENT); POST/PATCH (ADMIN)
    dto/{create,update}-checklist-template.dto.ts
    checklist-templates.service.spec.ts
  visits/
    visits.module.ts
    visits.service.ts                # agendar, check-in/out, checklist, fechar
    visits.controller.ts
    visit-report.service.ts          # gera o PDF (pdfkit) + dispara e-mail
    dto/{create,update}-visit.dto.ts
    dto/check-in.dto.ts
    dto/check-out.dto.ts
    dto/checklist-answer.dto.ts
    visits.service.spec.ts
    visit-report.service.spec.ts
```

`pdfkit` é a única dependência nova (backend). Upload de foto/assinatura
reaproveita `StorageService` + `FileInterceptor`, como em `assets`.

### 3.3 Rotas

**checklist-templates**
- `GET /checklist-templates?categoryId=` — `ADMIN`,`AGENT`
- `POST /checklist-templates` · `PATCH /checklist-templates/:id` — `ADMIN`
- `POST/PATCH /checklist-templates/:id/items` — `ADMIN` (adicionar/reordenar
  itens; sem exclusão física se já houver respostas — `active` não existe em
  item, então some da UI só quando o template pai fica inativo)

**visits**
- `GET /visits?technicianId=&date=&status=&ticketId=` — agenda por
  técnico/dia; `ADMIN`,`AGENT` veem todas, técnico vê as suas via
  `technicianId=me` (ou filtro implícito quando o próprio AGENT consulta
  sem especificar).
- `POST /visits` — `{ ticketId, technicianId, scheduledStart, scheduledEnd }`;
  resolve `checklistTemplateId` pela categoria do chamado (fallback padrão);
  evento `VISIT_SCHEDULED`.
- `PATCH /visits/:id` — reagendar (`scheduledStart/End`, `technicianId`),
  só quando `status: SCHEDULED`.
- `POST /visits/:id/cancel` — `status → CANCELLED`; evento
  `VISIT_CANCELLED`.
- `POST /visits/:id/check-in` — `{ lat?, lng? }`; exige `status: SCHEDULED`;
  grava `checkInAt`/`laborStartAt` = agora; `status → IN_PROGRESS`; ticket
  vira `IN_PROGRESS` se ainda `OPEN`; evento `VISIT_STARTED`.
- `POST /visits/:id/check-out` — `{ lat?, lng? }`; exige `status:
  IN_PROGRESS`; grava `checkOutAt`/`laborEndAt` = agora.
- `PATCH /visits/:id/labor` — `{ laborStartAt, laborEndAt }` — correção
  manual, sempre disponível pro AGENT/ADMIN.
- `PUT /visits/:id/checklist` — `{ answers: [{itemId, done, note?}] }` —
  upsert em lote das respostas.
- `POST /visits/:id/attachments` (multipart `file`, `kind`) — grava foto
  antes/depois ou assinatura via `StorageService`.
- `POST /visits/:id/close` — exige `checkOutAt` presente, todos os itens do
  template respondidos e um anexo `kind: SIGNATURE`; senão `400` com a lista
  do que falta. Sucesso: `status → DONE`, gera PDF (`visit-report.service`),
  envia e-mail com link, `reportSentAt` = agora, evento `VISIT_COMPLETED`.
- `GET /visits/:id/report` — redireciona/retorna o `Attachment` `REPORT` já
  gerado (reenvio manual: `POST /visits/:id/report/resend`).

### 3.4 Geração do laudo (`visit-report.service.ts`)

- Monta PDF com `pdfkit`: cabeçalho (nome/logo da empresa via `EmailService.brand()`),
  dados do chamado (número, título, cliente, local), técnico, janela agendada,
  check-in/checkout, horas trabalhadas, itens do checklist com estado,
  observações, assinatura (imagem embutida), rodapé com data de emissão.
- Sobe o buffer via `StorageService` como `Attachment(visitId, kind: REPORT,
  mime: 'application/pdf')`.
- Envia e-mail ao(s) contato(s) do cliente do chamado (mesmo destinatário
  usado pelas notificações de chamado existentes) com link
  `${APP_URL}/portal/anexos/:id` (ou rota equivalente já existente de
  download) — reaproveita `EmailService.send`.

### 3.5 Frontend

**Navegação**: dois itens novos em `/app` — **Agenda** e (para role `AGENT`)
**Campo**.

**`/app/agenda`** (desktop, `ADMIN`/`AGENT`)
- Filtro por técnico + data (padrão hoje).
- Lista agrupada por técnico, cada linha: horário, chamado (link), cliente/
  local, status da visita (badge), ações (reagendar, cancelar).
- Botão **Agendar visita** abre painel: chamado (busca), técnico, janela de
  data/hora.
- No detalhe do chamado (`/app/chamados/[id]`): novo bloco **Visitas** —
  lista as visitas do chamado + botão "Agendar visita" pré-preenchido.

**`/app/campo`** (mobile-first, role `AGENT`)
- Lista "Minhas visitas de hoje" (usa `GET /visits?technicianId=me&date=hoje`).
- **`/app/campo/[visitId]`**: tela de execução —
  1. Botão **Check-in** (captura geolocalização se permitida).
  2. Checklist: itens do template, checkbox + campo de observação, upload de
     fotos por item (before/after opcional).
  3. Canvas de assinatura do cliente (biblioteca nenhuma nova — `<canvas>` +
     `toDataURL('image/png')`, upload como `Attachment(kind: SIGNATURE)`).
  4. Botão **Check-out**.
  5. Botão **Fechar visita** — desabilitado até checklist completo +
     assinatura presentes; ao concluir, mostra confirmação "laudo enviado ao
     cliente".
- Ajuste de horas (`laborStartAt`/`laborEndAt`) editável num campo simples
  na mesma tela, para ADMIN/AGENT corrigirem depois.

### 3.6 Migração

Prisma migrate: tabelas novas `checklist_templates`,
`checklist_template_items`, `visits`, `visit_checklist_answers`;
`VisitStatus`/`AttachmentKind` enums; `attachments.visitId` +
`attachments.kind` (default `GENERIC`, sem backfill necessário); 4 valores
novos em `TicketEventType`. Seed do checklist padrão no boot.

## 4. Fluxos

### 4.1 Agendar
Dispatcher abre o chamado → **Agendar visita** → escolhe técnico + janela →
visita aparece na Agenda do técnico e na timeline do chamado
(`VISIT_SCHEDULED`).

### 4.2 Execução em campo
Técnico abre `/app/campo` no celular → visita do dia → **Check-in** (GPS se
permitido) → chamado vira `IN_PROGRESS` → preenche checklist + fotos →
cliente assina no canvas → **Check-out** → **Fechar visita** → PDF gerado e
e-mail com link disparado ao cliente automaticamente.

### 4.3 Revisita
Chamado que precisou de retorno: dispatcher agenda uma segunda `Visit` no
mesmo chamado (técnico igual ou diferente); cada visita tem seu próprio
checklist/laudo.

### 4.4 Correção de horas
Depois de fechada (ou durante), ADMIN/AGENT ajusta `laborStartAt`/
`laborEndAt` via `PATCH /visits/:id/labor` se o check-in/out não refletir a
realidade (ex.: técnico esqueceu o check-out).

## 5. Erros e bordas

- `POST /visits` com técnico que não é `AGENT` ativo → `400`.
- `check-in` numa visita que não está `SCHEDULED` → `409`.
- `check-out` numa visita que não está `IN_PROGRESS` → `409`.
- `close` sem checkout, sem checklist completo ou sem assinatura → `400`
  com `{ missing: ['checkout'|'checklist'|'signature'] }`.
- Reagendar (`PATCH`) uma visita já `IN_PROGRESS`/`DONE` → `409`.
- Geolocalização negada pelo navegador → check-in/checkout seguem sem
  lat/lng (não bloqueia).
- Falha ao gerar PDF ou enviar e-mail no `close` → a visita **ainda fecha**
  (`status: DONE`); erro fica só logado (mesmo padrão de `EmailService.send`
  hoje, que não propaga) — `reportSentAt` fica `null` e
  `POST /visits/:id/report/resend` permite tentar de novo manualmente.

## 6. Testes

Unit (Vitest):
- `checklist-templates.service` — seed idempotente, CRUD, fallback padrão
  quando categoria não tem template próprio.
- `visits.service` — transições de estado (`SCHEDULED→IN_PROGRESS→DONE`,
  cancelamento), resolução do template pela categoria do chamado, exigências
  do `close` (checklist completo + assinatura + checkout), horas derivadas
  do check-in/out, correção manual de horas, eventos de timeline.
- `visit-report.service` — monta PDF sem quebrar com dados ausentes
  (observação vazia, sem fotos), grava `Attachment(kind: REPORT)`, chama
  `EmailService.send` com o link certo.

Integração (exige Postgres):
- Ciclo completo: agendar → check-in → checklist → assinatura → check-out →
  fechar → `Attachment(kind:REPORT)` criado + `EmailService.send` chamado
  (mock do Resend, como já é feito hoje).
- `GET /visits` filtrando por técnico e papel (`AGENT` só vê as suas quando
  `technicianId=me`).
- `POST /visits/:id/close` recusando com checklist incompleto.

E2E Playwright (fumaça): agendar visita num chamado → abrir `/app/campo` →
check-in → responder checklist → assinar → check-out → fechar.

## 7. Sequência de implementação (rascunho pro plano)

1. Schema Prisma + migração (`ChecklistTemplate`, `Visit`,
   `VisitChecklistAnswer`, enums, campos em `Attachment`/`Ticket`, eventos).
2. `checklist-templates` (módulo + seed + testes).
3. `visits.service` — agendar, reagendar, cancelar + testes.
4. `visits.service` — check-in/check-out + horas + testes.
5. `visits.service` — checklist (upsert de respostas) + testes.
6. Anexos de visita (foto/assinatura) reaproveitando `StorageService`.
7. `visit-report.service` (`pdfkit` + `EmailService`) + `close` + testes.
8. Frontend: `/app/agenda` (lista, agendar, reagendar, cancelar).
9. Frontend: bloco Visitas no detalhe do chamado.
10. Frontend: `/app/campo` (lista do dia + tela de execução: check-in,
    checklist, canvas de assinatura, check-out, fechar).
11. Frontend: aba Checklists em `/app/config`.
12. Integração + E2E; CHANGELOG; release 0.4.0.

## 8. Versão

MINOR → **0.4.0** (funcionalidade nova, retrocompatível). Nenhuma env nova.
`CHANGELOG.md` em "Não lançado" durante o desenvolvimento.
