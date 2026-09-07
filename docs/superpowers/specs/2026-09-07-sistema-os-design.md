# Sistema de Ordens de Serviço (OS) — Design

**Data:** 2026-09-07
**Status:** Aprovado para planejamento
**Autor:** renanppires + Claude

---

## 1. Contexto e objetivo

Empresa de informática precisa de um sistema próprio de **chamados / ordens de
serviço**. O cliente (empresa atendida) terá várias formas de abrir chamado. No
MVP: **e-mail** e uma **página de portal** com acesso próprio. Outros canais
(WhatsApp, telefone) virão depois.

Projeto novo, construído do zero. Ideias pontuais podem ser trazidas do projeto
CondoDesk (schema, DTOs, templates de e-mail, lógica de SLA), mas nada é copiado
em bloco.

Idioma de todo o produto e de toda a comunicação do projeto: **português do
Brasil**.

## 2. Decisões travadas na brainstorm

| Tema | Decisão |
|---|---|
| Reuso do CondoDesk | Não. Projeto do zero; trechos avulsos sob demanda. |
| Stack | Backend NestJS + Prisma + Postgres; frontend Next.js (App Router); Docker Compose. |
| Conceito de domínio | **Um só registro: Chamado.** Sem separar Chamado × OS. |
| Papéis internos | `ADMIN` (configura tudo) e `AGENT` (atende, comenta, fecha, reatribui qualquer chamado). |
| Papéis do cliente | `MANAGER` (vê todos os chamados da empresa) e `CONTACT` (vê só os próprios). |
| SLA | Simples no MVP: prazo em horas por prioridade (global), vencimento calculado na criação, recalculado se a prioridade mudar, marca visual de "vencido". SLA por categoria = fase 2. |
| Canal e-mail | Resend **inbound** (webhook) para receber; Resend API para enviar. Um provedor só. |
| Infra | Só Postgres no MVP. Sem Redis/fila. Cron via `@nestjs/schedule`. |
| Tenancy | Single-tenant. "Cliente" = empresa atendida, não tenant isolado. |
| Anexos | Disco em volume Docker. S3 = fase 2. |
| Versionamento | SemVer + `CHANGELOG.md` (Keep a Changelog), início em `0.1.0`. Conventional Commits. Git criado pelo usuário depois. |

## 3. Arquitetura

```
Z:\Projetos\OS
├─ backend/                NestJS + Prisma
│  ├─ prisma/schema.prisma
│  └─ src/
│     ├─ auth/             JWT (access + refresh), bcrypt, guards por papel
│     ├─ users/            usuários internos + contatos de cliente, convites
│     ├─ clients/          CRUD de empresas atendidas
│     ├─ categories/       CRUD de categorias
│     ├─ sla/              SlaPolicy (4 prioridades → horas), cálculo de vencimento
│     ├─ tickets/          CRUD, transições de status, atribuição, timeline
│     ├─ comments/         andamentos (interno/público)
│     ├─ attachments/      upload em disco, download com checagem de acesso
│     ├─ email/            envio via Resend + templates
│     ├─ inbound/          webhook Resend, parsing, dedupe, threading
│     ├─ notifications/    disparo de e-mail por evento
│     └─ common/           filtros, interceptors, paginação
├─ frontend/               Next.js App Router + Tailwind + shadcn/ui
│  └─ src/app/
│     ├─ app/              área da equipe
│     └─ portal/           área do cliente
├─ docker-compose.yml      produção: postgres, backend, frontend, volume uploads
├─ docker-compose.dev.yml  hot reload, portas expostas
├─ .env.example
├─ CHANGELOG.md
└─ README.md
```

Sem Redis. Sem multi-idioma. Sem dark mode. Sem logo gerado no MVP (cor de marca
placeholder, trocada depois).

## 4. Modelo de dados (Prisma)

Enums: `UserType {INTERNAL, CLIENT}`, `UserRole {ADMIN, AGENT, MANAGER, CONTACT}`,
`TicketStatus {OPEN, IN_PROGRESS, WAITING_CLIENT, RESOLVED, CLOSED, CANCELLED}`,
`TicketPriority {LOW, MEDIUM, HIGH, URGENT}`, `TicketOrigin {EMAIL, PORTAL, MANUAL}`,
`CommentVisibility {INTERNAL, PUBLIC}`,
`TicketEventType {CREATED, STATUS_CHANGED, ASSIGNED, PRIORITY_CHANGED, COMMENT, EMAIL_IN, EMAIL_OUT}`.

### User
`id, name, email (unique), passwordHash?, type, role, clientId?, active (bool),
inviteToken?, inviteSentAt?, lastLoginAt?, createdAt, updatedAt`
- `passwordHash` nulo enquanto o convite não foi aceito.
- `clientId` obrigatório quando `type = CLIENT`.

### Client
`id, name, cnpj?, emailDomains (string[]), notes?, active, createdAt, updatedAt`
- `emailDomains`: domínios usados para casar remetente de e-mail com o cliente.

### Category
`id, name (unique), active, createdAt, updatedAt`

### SlaPolicy
`priority (PK, TicketPriority), hours (int), updatedAt`
- Seed inicial: URGENT=4, HIGH=8, MEDIUM=24, LOW=72 (ajustável).

### Ticket
`id, number (unique, "AAAA-NNNN"), title, description, clientId?, requesterId (User)?,
categoryId?, priority (default MEDIUM), status (default OPEN), assigneeId (User)?,
origin, equipment?, needsTriage (bool, default false), slaDueAt?, firstResponseAt?,
resolvedAt?, closedAt?, createdAt, updatedAt`
- `clientId`/`requesterId` nulos **apenas** em chamado de e-mail com domínio
  desconhecido (`needsTriage = true`). O agente vincula cliente + contato e
  `needsTriage` volta a `false`. Todo chamado de Portal/Manual tem os dois.
- `number`: sequência por ano. Contador em tabela `Counter {year (PK), value}` com
  incremento transacional.
- `slaDueAt = createdAt + SlaPolicy[priority].hours`. Recalculado em mudança de
  prioridade enquanto o chamado não está `RESOLVED/CLOSED/CANCELLED`.
- `firstResponseAt`: primeiro comentário público de um usuário interno.

### TicketComment
`id, ticketId, authorId, body, visibility, createdAt`

### TicketEvent
`id, ticketId, type, data (Json), actorId?, createdAt`
- Timeline de auditoria. `data` guarda de/para em mudanças de status/prioridade/atribuição.

### Attachment
`id, ticketId?, commentId?, filename, storedPath, mime, size, uploadedById, createdAt`
- Exatamente um de `ticketId`/`commentId` preenchido.

### InboundEmail
`id, messageId (unique), ticketId?, fromEmail, subject, receivedAt, headers (Json)`
- Dedupe por `messageId`. Threading por `In-Reply-To`/`References` → `InboundEmail`
  existente → `ticketId`; fallback: regex `[#AAAA-NNNN]` no assunto.

### RefreshToken
`id, userId, tokenHash, expiresAt, revokedAt?, createdAt`

## 5. Regras de negócio

### 5.1 Numeração
Contador anual transacional. Formato `2026-0001`, zero-padded a 4 dígitos, sem reset
no meio do ano; vira `2027-0001` na virada.

### 5.2 Transições de status
Livres para `ADMIN`/`AGENT` (qualquer → qualquer, exceto sair de `CANCELLED`/`CLOSED`
exige reabertura explícita para `OPEN`). Efeitos:
- `→ RESOLVED`: grava `resolvedAt`, dispara e-mail ao solicitante.
- `→ CLOSED`: grava `closedAt`.
- `→ OPEN` a partir de `RESOLVED/CLOSED`: limpa `resolvedAt`/`closedAt`.
Cliente (portal) não muda status; ao responder um chamado `WAITING_CLIENT`, o
status volta para `IN_PROGRESS` automaticamente.

### 5.3 Visibilidade
- `CONTACT`: apenas chamados onde `requesterId = ele`.
- `MANAGER`: todos os chamados do seu `clientId`.
- Portal nunca exibe comentários `INTERNAL` nem eventos internos.
- `AGENT`/`ADMIN`: tudo.

### 5.4 SLA
`slaDueAt` só informativo/visual no MVP (sem parar relógio em `WAITING_CLIENT` —
isso é fase 2). "Vencido" = `slaDueAt < now` e status não terminal.

### 5.5 Convite de contato
Admin/Agent cria `User CLIENT` sem senha → gera `inviteToken` → e-mail com link
`/portal/definir-senha?token=...` (validade 7 dias) → usuário define senha, token é
consumido.

## 6. Canais de entrada

### 6.1 E-mail (Resend inbound)
1. MX de `suporte.<dominio>` apontado para o Resend.
2. Resend faz `POST` no webhook `POST /webhooks/resend/inbound` com o e-mail
   parseado (texto, html, anexos, headers). Validação do signing secret
   (`RESEND_INBOUND_SECRET`); requisição inválida → 401.
3. Dedupe por `messageId`.
4. Threading: se casar com `InboundEmail` anterior → adiciona `TicketComment`
   `PUBLIC` no chamado, autor = `requesterId`, e `TicketEvent EMAIL_IN`. Se o
   chamado estava `WAITING_CLIENT` → volta a `IN_PROGRESS`.
5. Novo chamado: casa `fromEmail` com um `User CONTACT` existente. Se não existir,
   casa o domínio com `Client.emailDomains` e cria `User CONTACT` `active=false`
   ("não verificado"). Domínio desconhecido → cria chamado sem cliente numa
   **fila de triagem** (`needsTriage = true`, `clientId`/`requesterId` nulos;
   agente vincula manualmente e a flag é baixada).
6. Anexos do e-mail viram `Attachment` do chamado.
7. Corpo: usa `text`; faz strip de assinatura/quote básico (regex de linhas `>` e
   marcadores comuns "Em ... escreveu:").

> Local: webhook precisa de URL pública. Testar com túnel (cloudflared) ou validar
> só no servidor. Todo o resto roda offline.

### 6.2 Portal
Contato autenticado → formulário (título, descrição, categoria, prioridade
sugerida, anexos) → `Ticket origin=PORTAL`, `requesterId` = ele.

### 6.3 Manual
Agente no painel escolhe cliente + contato + dados → `Ticket origin=MANUAL`.

## 7. Notificações (e-mail via Resend)

| Evento | Destinatário | Template |
|---|---|---|
| Chamado criado | Solicitante (confirmação c/ número) + admins | `ticket-created`, `ticket-created-internal` |
| Comentário `PUBLIC` novo | Solicitante + manager(es) do cliente | `ticket-comment` |
| Chamado atribuído | Novo responsável | `ticket-assigned` |
| Status → `RESOLVED` | Solicitante | `ticket-resolved` |
| SLA vencido (cron 15 min) | Responsável + admins | `ticket-sla-breached` |
| Convite de contato | Contato | `contact-invite` |

Remetente: `suporte@<dominio>`. `Reply-To` = `suporte@<dominio>` para o inbound
capturar respostas. Cabeçalho `References` inclui o `messageId` do chamado para
threading em clientes de e-mail.

## 8. Autenticação e autorização

- E-mail + senha, `bcrypt`. JWT **access** (15 min) + **refresh** (30 dias,
  `RefreshToken` com hash, rotacionado no uso).
- Guard global exige autenticação; `@Roles(...)` por rota.
- Sem SSO, sem magic link no MVP.
- `/app` e `/portal` compartilham o mesmo backend; o `type` do usuário define a
  área permitida.

## 9. Interface

**Stack front:** Next.js App Router, Tailwind, shadcn/ui, TanStack Query,
react-hook-form + zod. pt-BR, tema claro, 1 cor de marca placeholder.

### `/app` — equipe
1. **Login**
2. **Fila de chamados** — tabela paginada; filtros: status, prioridade, cliente,
   responsável, categoria, "vencidos"; busca por número/título; ordenação.
3. **Detalhe do chamado** — cabeçalho com status / prioridade / responsável
   editáveis inline; timeline (comentários + eventos); caixa de resposta com
   alternância **interno / público** e anexos; painel lateral com solicitante,
   cliente, categoria, datas, SLA.
4. **Novo chamado** (manual).
5. **Clientes** — lista + CRUD; detalhe com abas **Contatos** e **Chamados**.
6. **Contatos** (dentro do cliente) — criar/editar, "enviar convite", ativar/desativar.
7. **Configurações** — categorias (CRUD), política de SLA (4 campos de horas),
   usuários internos (CRUD + papel).
8. **Perfil** — trocar senha.

### `/portal` — cliente
1. **Login** + **esqueci a senha** + **definir senha** (via convite).
2. **Chamados** — `CONTACT` vê os seus; `MANAGER` vê todos da empresa. Lista com
   status e número.
3. **Detalhe** — timeline só com andamentos públicos; responder; anexar.
4. **Abrir chamado**.
5. **Perfil** — trocar senha.

## 10. Deploy

- `docker-compose.yml`: `postgres` (volume dados), `backend` (migrate + start),
  `frontend`, volume `uploads`.
- `docker-compose.dev.yml`: hot reload, portas 3000/3001/5432 expostas.
- `.env.example`: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `RESEND_API_KEY`, `RESEND_INBOUND_SECRET`, `APP_URL`, `PORTAL_URL`,
  `MAIL_FROM`, `STORAGE_PATH`.
- Começa local; usuário cria o repositório git depois.

## 11. Testes (Ponytail — só onde há lógica)

Backend (Jest):
- numeração transacional (sem colisão em concorrência simulada);
- criação de chamado pelos 3 canais;
- transições de status e seus efeitos (`resolvedAt`, volta de `WAITING_CLIENT`);
- cálculo e recálculo de `slaDueAt`;
- `firstResponseAt` no primeiro público interno;
- dedupe do inbound por `messageId`;
- threading do inbound (In-Reply-To e fallback `[#AAAA-NNNN]`);
- visibilidade por papel (CONTACT/MANAGER/AGENT).

Frontend: 1 fluxo Playwright — contato abre chamado no portal e vê na lista.

## 12. Fora do MVP (fase 2+)

Cadastro de ativos/equipamentos, CSAT/avaliação do chamado, SLA por categoria e
pausa de relógio em `WAITING_CLIENT`, WhatsApp, base de conhecimento,
dashboard/relatórios, magic link, storage S3, multi-idioma, dark mode, logo/CI.

## 13. Versionamento

- SemVer. `CHANGELOG.md` no formato Keep a Changelog. Primeira versão `0.1.0`.
- Conventional Commits (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`).
- CHANGELOG atualizado a cada entrega, mesmo antes de existir repositório git.
