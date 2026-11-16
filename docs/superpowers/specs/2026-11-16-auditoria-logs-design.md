# Auditoria e logs — design

**Data:** 2026-11-16 · **Status:** aguardando aprovação

## Por quê
Hoje só o chamado tem histórico (`TicketEvent`). Não há como saber quem alterou um cliente, uma configuração ou apagou algo. Além disso, as falhas de integração (S3, e-mail, WhatsApp, crons) só aparecem no console do container — o 502 do S3 de 2026-11-16 é o exemplo: o admin via "502" e nada mais.

## Objetivos
1. **Quem fez o quê:** registrar toda ação de escrita feita por usuário (e login ok/falho).
2. **O que deu errado:** registrar `warn`/`error` do backend num lugar que o admin enxerga.
3. Uma tela só para consultar os dois, restrita a ADMIN.

## Não-objetivos
- Diff "antes → depois" por campo (abordagem B) — fica para depois, se necessário, só em módulos específicos.
- Stack externa de logs (Loki/Grafana).
- Substituir `TicketEvent` (continua sendo o histórico do chamado).

## Anti-objetivos
- Gravar segredo em claro (senha, chave S3, token, API key) — falha grave mesmo que "funcione".
- Inundar a tabela com tráfego de máquina (checkin de agente, webhooks de equipamento).
- Auditoria que derruba a requisição: falha ao gravar o log nunca quebra a operação do usuário.

## Abordagens consideradas
- **A) Tabela única + interceptor global + logger persistente** — *escolhida*. Cobre as ~99 rotas de escrita e os ~25 `logger.warn/error` existentes sem tocar nos módulos. Limitação: registra o que foi enviado, não o valor anterior.
- B) Extensão Prisma com diff por campo — mais rica, mas leitura extra por gravação e muito ruído de crons/checkins.
- C) Loki/Grafana — mais um serviço para manter; desproporcional ao volume atual.

## Desenho
**Tabela `AuditLog`** (`audit_logs`): `id`, `createdAt`, `kind` (`ACTION` | `ERROR`), `level` (`info`/`warn`/`error`), `actorId?` (User, SetNull), `actorLabel?` (e-mail, p/ login falho e usuário apagado), `ip?`, `method?`, `path?`, `status?`, `module` (ex.: `clients`, `storage`, `SettingsController`), `message`, `data Json?`. Índices em `createdAt`, `(kind, createdAt)`, `actorId`.

**Coletor de ações — interceptor global:**
- Só `POST/PUT/PATCH/DELETE`. Grava após a resposta (sucesso ou erro, com o status HTTP).
- Usuário vem de `req.user` (guard global já roda antes); login falho usa o e-mail do corpo.
- Corpo gravado em `data`, **mascarado** recursivamente: chaves que contenham `password`, `secret`, `token`, `apikey`, `key` (exceto `id`-likes), `authorization` → `"***"`. Tamanho limitado (~4 KB, trunca).
- Upload (multipart): grava nome/tamanho/mime do arquivo, nunca o conteúdo.
- **Fora:** `/api/agent/checkin`, `/api/integrations/events`, webhooks inbound (Resend, WhatsApp) e `/api/auth/refresh`.
- Gravação "fire and forget" com `catch` — erro ao gravar vai só pro console.

**Coletor de falhas — logger do Nest:**
- `ConsoleLogger` estendido, registrado em `main.ts` (`bufferLogs` + `app.useLogger`). Continua imprimindo no console; `warn`/`error` também viram `AuditLog kind=ERROR` com `module` = contexto do logger e `stack` em `data`.
- Proteção contra recursão: falha ao gravar não chama o próprio logger. Erros não tratados (500) que o Nest já loga entram por aqui.

**Retenção:** cron diário apaga registros mais antigos que `audit.retentionDays` (Setting, padrão 90).

**API:** `GET /api/audit` (ADMIN) com filtros `kind`, `actorId`, `module`, `from`, `to`, `q` (texto em message/path) e paginação existente (`pagination.dto`).

**Tela:** Configurações → aba **Auditoria**: tabela (data, tipo, usuário, ação/módulo, status, mensagem), filtros acima, clique na linha abre o `data` formatado. Campo da retenção no mesmo lugar.

## Decisões minhas (para revisar)
- Retenção padrão 90 dias, configurável.
- Login registrado (sucesso e falha); refresh de token não.
- GET (leituras) não são auditados.
- Mascaramento por nome de chave, não por lista de rotas.

## Para quem for construir
Nome exato das chaves de Setting, layout da tabela no front, formato do índice e onde fica o módulo (`src/audit/`) seguem os padrões já usados no projeto.
