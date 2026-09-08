# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Stack do Portainer (`portainer-stack.yml`) puxando imagens do Docker Hub, com
  todo domínio/segredo em variáveis de ambiente; `deploy/` com `stack.env.example`,
  script de build/push e guia de deploy.

### Alterado
- Imagem do backend roda o seed idempotente no boot (admin, SLA, categorias);
  `tsx` movido para `dependencies`; runtime instala deps com scripts.
- Frontend cai em `/api` relativo quando `NEXT_PUBLIC_API_URL` não é definido —
  a mesma imagem serve qualquer domínio (front e API no mesmo host).
- `DATABASE_URL` do `docker-compose.yml` passa a usar `POSTGRES_USER/PASSWORD/DB`.
- Seed sem `SEED_ADMIN_*` apenas pula a criação do admin (não aborta mais).

## [0.1.0] - 2026-09-07

### Adicionado

- **Infraestrutura**: monorepo backend NestJS + frontend Next.js 14; Docker Compose (dev e produção); Prisma/PostgreSQL com migrations e seed inicial.
- **Autenticação**: login, refresh rotativo e logout JWT; papéis ADMIN/AGENT/MANAGER/CONTACT; convite de contato e definição/recuperação de senha por e-mail.
- **Cadastros**: clientes, contatos, categorias, usuários internos.
- **Chamados**: numeração anual; prioridade e SLA por prioridade; transições de status com reabertura; atribuição com recálculo de SLA; timeline de eventos; visibilidade por papel; fila de triagem.
- **Andamentos**: comentários internos e públicos; primeira resposta; reabertura automática ao cliente responder.
- **Anexos**: upload em disco; download autenticado com checagem de acesso.
- **E-mail de saída**: notificações por evento via Resend (chamado criado, andamento público, atribuição, resolvido, SLA vencido); templates pt-BR com escape de HTML.
- **E-mail de entrada**: webhook do Resend com deduplicação por messageId, threading e fila de triagem.
- **SLA**: cron de notificação de vencimento.
- **Interface da equipe (`/app`)**: fila com filtros, detalhe do chamado, novo chamado, clientes/contatos, configurações.
- **Portal do cliente (`/portal`)**: lista, abertura e acompanhamento de chamados.
- **Testes**: unitários e integração no backend; smoke E2E (Playwright) de abertura de chamado no portal.
