# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- **Pesquisa de satisfação (CSAT)** por chamado (fase 0.7.0, parte 1/4): ao
  fechar, gera nota 1–5 + comentário opcional via link público sem login
  pro solicitante; a resposta aparece na ficha do chamado. Uma pesquisa por
  chamado — reabrir e fechar de novo não gera segunda.
- **Dashboard de gestão** (`/app/dashboard`): chamados abertos/vencidos,
  recorrente vs avulso, tempo médio de atendimento, produtividade por
  técnico, contratos com franquia estourada e margem por chamado avulso —
  tudo do mês civil corrente.
- **SLA real**: o prazo pausa enquanto o chamado está "Aguardando
  cliente" (o tempo pausado é somado de volta ao sair do estado) e
  ganha um terceiro nível de SLA por categoria (Contrato > Categoria >
  Global).

## [0.6.0] - 2026-09-20

### Adicionado
- **Catálogo** de serviços e produtos (preço, unidade).
- **Estoque** por depósito (inclusive "van do técnico"): saldo, entrada com
  custo unitário e custo médio ponderado, transferência atômica entre
  depósitos, requisição de material amarrada ao chamado (baixa direta, sem
  aprovação), alerta visual de estoque mínimo.
- **Orçamento**: itens do catálogo (serviço + material), nasce de um
  chamado existente ou avulso, versionado (revisão = nova versão ligada à
  proposta original), aprovação/rejeição do cliente por link público sem
  login — aprovado (e avulso) vira chamado automaticamente.

## [0.5.0] - 2026-09-18

### Adicionado
- **Contratos de manutenção recorrente**: vigência, valor mensal, escopo de
  Locais/Ativos, franquia (visitas ou horas/mês), SLA próprio opcional por
  prioridade.
- Chamado dentro do escopo de um contrato ativo se vincula sozinho a ele.
- Geração automática de chamados preventivos no calendário do contrato (um
  por Local do escopo).
- Aviso automático por e-mail (ADMIN) 30 dias antes do fim da vigência.
- Ficha de contrato (`/app/contratos`) com escopo editável, SLA por
  prioridade, consumo do mês e cancelamento; aba Contratos no cliente; badge
  de contrato no chamado.

## [0.4.0] - 2026-09-18

### Adicionado
- **Visitas técnicas** vinculadas ao chamado: agendamento (técnico + janela de
  data/hora), reagendamento e cancelamento.
- **Agenda** por técnico e dia (`/app/agenda`).
- **Execução em campo** (`/app/campo`, mobile): check-in/check-out com
  geolocalização opcional, checklist configurável por categoria com fotos,
  assinatura do cliente em canvas, apontamento de horas (derivado do
  check-in/out, editável).
- **Laudo de atendimento em PDF**, gerado e enviado por e-mail ao cliente
  automaticamente ao fechar a visita (link pro chamado no portal).
- Cadastro de **Checklists** por categoria em Configurações.

### Alterado
- Chamado `OPEN` vira `IN_PROGRESS` automaticamente no check-in da primeira
  visita.

## [0.3.0] - 2026-09-10

### Adicionado
- Cadastro de **Locais** por cliente (endereço, contato no local, observações
  de acesso).
- **Tipos de ativo** configuráveis pelo ADMIN (aba em Configurações).
- Cadastro de **Ativos/equipamentos** por local: dados de rede (IP/MAC),
  credenciais de acesso criptografadas (visíveis só à equipe), fotos, garantia
  e status.
- Chamado passa a referenciar um **Local** e um ou mais **Ativos**; a ficha do
  ativo lista o histórico de chamados vinculados.
- Importação de ativos por **CSV** (cliente, local e tipo resolvidos por nome;
  relatório de erros por linha).

### Alterado
- O campo livre "Equipamento" do chamado foi aposentado: sai dos formulários e
  fica só-leitura em chamados antigos que já tinham valor.

## [0.2.0] - 2026-09-09

### Adicionado
- Configurações no app (`/app/config`, abas visíveis só para ADMIN): credenciais
  do Resend, armazenamento S3, aparência e backup — antes só via `.env`.
- Segredos de configuração criptografados no banco (AES-256-GCM); nova variável
  de ambiente `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`).
- Armazenamento de anexos em bucket S3 (AWS, Cloudflare R2, MinIO), com leitura
  retrocompatível dos anexos já gravados em disco (dual-read, sem migração).
- Backup dos dados em JSON: download sob demanda, importação com restauração
  total (confirmação "RESTAURAR") e backup diário automático (03:00) para o
  armazenamento configurado, com retenção ajustável.
- Aparência: logo, nome da empresa e cor primária aplicados no app, no portal,
  nas telas de login, nos e-mails e no título/favicon da aba.

### Alterado
- `EmailService` e o webhook inbound do Resend passam a ler a configuração do
  banco, mantendo `RESEND_API_KEY`, `MAIL_FROM` e `RESEND_INBOUND_SECRET` como
  fallback.
- `Attachment.storedPath` passa a guardar uma chave relativa (`attachments/…`)
  para anexos novos; os antigos (caminho absoluto) seguem sendo lidos do disco.

## [0.1.1] - 2026-09-08

### Adicionado
- Stack do Portainer (`portainer-stack.yml`) puxando imagens do Docker Hub, com
  todo domínio/segredo em variáveis de ambiente; `deploy/` com `stack.env.example`,
  script de build/push e guia de deploy.
- Serviço `cloudflared` no stack: publica o sistema por Cloudflare Tunnel, sem
  expor nenhuma porta no host. O servidor Next encaminha `/api/*` para o backend
  na rede interna (`BACKEND_INTERNAL_URL`), então front e API ficam na mesma
  origem — um único hostname no túnel.
- **Segurança**: `helmet` no bootstrap; rate limiting por IP nas rotas de
  autenticação (`login`/`set-password` 10/min, `forgot-password` 5/min) com a
  chave mascarada por sub-rede IPv6 e o IP real lido de `CF-Connecting-IP`;
  detecção de reuso de refresh token (revoga a família, com janela de 10s para
  não derrubar sessões em corrida de abas).

### Alterado
- Imagem do backend roda o seed idempotente no boot (admin, SLA, categorias);
  `tsx` movido para `dependencies`; runtime instala deps com scripts.
- Frontend cai em `/api` relativo quando `NEXT_PUBLIC_API_URL` não é definido —
  a mesma imagem serve qualquer domínio.
- `DATABASE_URL` do `docker-compose.yml` passa a usar `POSTGRES_USER/PASSWORD/DB`.
- Seed sem `SEED_ADMIN_*` apenas pula a criação do admin (não aborta mais).

### Corrigido
- `GET /api/attachments/:id` nega download de anexo de comentário interno a
  usuário do portal (IDOR latente).
- Middleware do Next remove `X-Forwarded-For` de entrada antes de encaminhar ao
  backend.

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
