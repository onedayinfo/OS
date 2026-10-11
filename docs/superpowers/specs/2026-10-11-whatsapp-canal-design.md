# WhatsApp como canal — escuta de grupos, gatilhos e triagem por IA (fase 1)

Data: 2026-10-11
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `c17f404` (release 0.11.0)
Roadmap: "WhatsApp como canal" estava no backlog (`docs/roadmap.md`); esta é a fase 1,
só escuta. Inspirada na apresentação do produto Data Sentinel (Sdruvis).

## 1. Objetivo

100% do atendimento a clientes acontece em grupos de WhatsApp. Hoje pedidos e
reclamações ficam soltos nos grupos. Esta fase faz o OS **escutar** os grupos dos
clientes e transformar mensagens em chamados, sem enviar nada de volta.

Entregas:

1. Conector WhatsApp (Evolution API) na stack, com um celular da empresa pareado
   por QR code, **somente leitura** (nada é enviado).
2. Cada cliente cadastra o **ID do grupo** (JID, copiado da Evolution); o grupo
   identifica o cliente, independente de quem escreve. Mensagens gravadas por 90
   dias (configurável).
3. **Frases de gatilho** por cliente ("Sistema caiu", "Sem conexão"…) que criam
   chamado direto, sem IA.
4. **Triagem por IA** (Claude Haiku 5.5): mensagens que não casam com gatilho
   são analisadas em lote e viram *sugestões*; o técnico confirma ou descarta.
5. Conjunto padrão global de frases em Configurações, copiado para o cliente.

Uso interno, single-tenant. Venda futura = uma stack por cliente (sem multi-tenant).

## 2. Fora do escopo (decisões explícitas)

- **Enviar mensagens** (confirmação no grupo, avisos, CSAT). Motivo: a Cloud API
  oficial da Meta não envia para grupos; postar no grupo exigiria o número não
  oficial e aumenta o risco de banimento. Fase 2: confirmação por mensagem
  individual via número oficial.
- Resumos periódicos, painel de sentimento, transcrição de áudio, detecção de
  mensagem apagada. O campo `sentiment` já é gravado (vem no mesmo JSON da IA, sem
  custo extra) para uso futuro.
- Mídia: áudio/imagem/documento são gravados só como tipo (`AUDIO`, `IMAGE`…), sem
  interpretação.
- Multi-tenant; resposta pelo portal; retomar conversa do grupo dentro do chamado.

## 3. Modelo de dados (Prisma)

- `WhatsappGroup`: `id`, `externalId` (JID, `@unique`, formato `...@g.us`, validado),
  `name?` (apelido do usuário; preenchido com o nome da Evolution se vazio),
  `clientId` (obrigatório), `active`, timestamps. Cliente 1:N grupos; um JID
  pertence a um único cliente.
- `WhatsappMessage`: `id`, `externalId` (`@unique`, idempotência), `groupId`,
  `senderPhone`, `senderName?`, `senderUserId?` (contato do cliente, se casou),
  `type` (`TEXT|AUDIO|IMAGE|OTHER`), `body?`, `sentAt`, `aiStatus`
  (`PENDING|ANALYZED|SKIPPED|FAILED`), `aiResult Json?`, `sentiment Float?`,
  `ticketId?` (chamado criado/anexado a partir dela), `createdAt`.
  Índices: `[groupId, sentAt]`, `[aiStatus]`.
- `TriggerPhrase`: `id`, `clientId?` (nulo = padrão global), `phrase`,
  `phraseNorm` (sem acento, minúscula), `categoryId`, `priority`, `title?`,
  `active`, `@@unique[clientId, phraseNorm]`.
- `TicketSuggestion`: `id`, `groupId`, `clientId`, `messageIds String[]`,
  `excerpt`, `urgency Int`, `sentiment Float?`, `summary`, `status`
  (`OPEN|ACCEPTED|DISCARDED`), `ticketId?`, `decidedById?`, `decidedAt?`,
  `createdAt`. Aceite/descarte ficam registrados (medir erros da IA).
- `User.phone String?` (novo): telefone do contato do cliente, normalizado só
  dígitos com DDI, usado para casar o remetente. **Hoje o contato não tem
  telefone** — campo novo + edição no cadastro de usuário do cliente.
- Enum `TicketOrigin` (hoje `EMAIL|PORTAL|MANUAL|CONTRACT|QUOTE`) ganha `WHATSAPP`.
- Configurações (`Setting`): `whatsapp.retentionDays` (90),
  `ai.anthropicApiKey` (cifrada, mesmo padrão do Resend), `ai.dailyTokenLimit`,
  `whatsapp.evolution.*` (URL interna e chave da instância).

## 4. Fluxo de uma mensagem

1. Evolution → `POST /api/whatsapp/webhook`, protegido por segredo
   (`@Public` + verificação de header; mesmo cuidado do webhook de e-mail).
   Segredo errado → 401, nada gravado.
2. O cliente é definido pelo **JID do grupo cadastrado** na ficha do cliente, nunca
   pelo número de quem escreve. Mensagem de grupo cujo JID não está cadastrado (ou
   está inativo) é descartada sem gravar nada; mensagem que não é de grupo também.
3. Mensagem de grupo cadastrado é gravada (idempotente por `externalId`). O
   telefone do remetente só serve para identificar o **contato** (`User.phone`
   dentro do cliente); qualquer pessoa do grupo, conhecida ou não, gera mensagem e
   gatilho. Sem casamento: `senderUserId = null` e o chamado sai com "remetente
   não identificado".
4. **Gatilho**: se `body` normalizado *começa com* `phraseNorm` de uma frase ativa
   do cliente (a mais longa vence), cria chamado direto. O restante do texto vira
   a descrição; título = `title` da frase ou a própria frase; categoria e
   prioridade da frase. Criação pelo mesmo caminho sem ator humano usado por
   `createFromQuote`/`ContractPreventiveCron`. Guarda `ticketId` na mensagem.
   **Dedup**: se já existe chamado aberto criado pela mesma frase no mesmo grupo,
   a mensagem é anexada como andamento ao chamado existente em vez de abrir outro.
5. **Sem gatilho**: `aiStatus = PENDING`.
6. **Job de IA** (cron a cada ~5 min, `@nestjs/schedule` já em uso): por grupo,
   pega mensagens `PENDING`, descarta triviais ("ok", "bom dia", emoji, figurinha →
   `SKIPPED`), monta uma janela (novas + poucas anteriores de contexto) e chama
   Claude Haiku 5.5 com saída estruturada validada por schema:
   `{ isRequest, urgency 1-5, sentiment -1..1, summary }`. Se `isRequest`, cria
   `TicketSuggestion`. Prompt fixo com cache de prompt.
7. **Triagem** (`/app/triagem`, ADMIN/AGENT): lista de sugestões `OPEN` com grupo,
   trecho e urgência; **Criar chamado** (pré-preenche cliente/descrição, vincula
   as mensagens) ou **Descartar**.

## 5. IA

- SDK `@anthropic-ai/sdk` no backend; modelo `claude-haiku-5-5` (escolha do
  usuário; custo estimado ~US$ 1–2/mês para ≤500 msgs/dia, a medir).
- Chave em `/app/config`, cifrada (AES, `SettingsService`).
- Registra `usage` (tokens) por rodada; **teto diário** configurável — ao exceder,
  o job pausa até o dia seguinte e avisa na tela.
- Sem `tool_choice` forçado; usar saída estruturada (`output_config.format`).
- Testes nunca chamam a API real (cliente de IA injetável e falso).
- Privacidade: texto de clientes sai para a API da Anthropic; documentar na
  tela de Config e avisar participantes dos grupos (responsabilidade do usuário).

## 6. Telas

- **Ficha do cliente → aba "WhatsApp"**: (a) Grupos do cliente: campo para
  colar o **ID do grupo** copiado da Evolution (valida `@g.us` e unicidade; erro
  claro se o ID já pertence a outro cliente), apelido opcional, ativar/desativar,
  remover; (b) Frases de gatilho (frase, categoria,
  prioridade, título opcional, ativa) + botão **Aplicar frases padrão** (copia o
  conjunto global; mudar o padrão depois não altera clientes existentes).
- **Config → WhatsApp**: status da conexão e QR code,
  frases padrão globais, retenção, chave/limite de IA.
- **/app/triagem**: fila de sugestões.
- Ficha do chamado: link para as mensagens de origem; cadastro de usuário do
  cliente ganha o campo telefone.

## 7. Falhas

- Evolution/celular desconectado: verificação periódica de status e aviso em
  Config e Triagem ("WhatsApp desconectado desde HH:MM"). Mensagens durante a
  queda podem se perder (conector não é fila confiável).
- API de IA indisponível/sem crédito/chave inválida: mensagens seguem `PENDING`,
  job tenta na rodada seguinte; gatilhos não são afetados; aviso na tela.
- Resposta fora do schema: mensagem `FAILED` ("não analisada"), sem derrubar o job.
- Retenção: cron diário apaga o `body`/registro de mensagens mais antigas que
  `retentionDays`; chamados, sugestões e `ticketId` permanecem.

## 8. Testes

- Unitários: normalização e "começa com" (acento, caixa, frase mais longa vence),
  filtro de triviais, dedup por grupo+frase, validação do schema da IA com cliente
  falso, casamento de telefone, teto de gasto.
- Integração (Postgres real): webhook → `WhatsappMessage` → chamado; idempotência
  (mesma mensagem 2x); grupo sem vínculo descartado; segredo inválido → 401;
  gatilho com remetente não identificado.
- Boot real do backend (`start:prod`) ao menos uma vez (lição de DI da 0.4.0).
- E2E: vincular grupo + cadastrar frase + aplicar padrão; confirmar sugestão na
  Triagem.
- Manual: celular real pareado em desenvolvimento antes do deploy.

## 9. Ordem de construção

1. Modelos, migração, `User.phone`, frases padrão globais.
2. Evolution na stack + webhook + gravação das mensagens.
3. Aba WhatsApp do cliente (grupos e frases) e "Aplicar frases padrão".
4. Chamado automático por gatilho.
5. Job de IA, Triagem e controle de gasto.
6. Retenção, aviso de desconexão, E2E, docs de deploy (`deploy/README.md`,
   `portainer-stack.yml`).

## 10. Riscos

- Evolution é API **não oficial**: pode quebrar com mudanças do protocolo e há
  risco de banimento do número que escuta. Mitigação: chip separado, somente
  leitura, nada enviado.
- Falsos positivos/negativos da IA: mitigados pela fila de triagem e pelo registro
  de aceite/descarte.
- Requisitos exatos da Evolution (banco, Redis, imagem) e limites da versão
  gratuita da WAHA devem ser **confirmados na documentação** antes do plano.
