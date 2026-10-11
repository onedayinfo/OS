# WhatsApp — conexão automática (assistente "Conectar WhatsApp")

Data: 2026-10-11
Estado: proposto (aguardando revisão do usuário)
Base: `main` @ `f78df93` (release 0.12.0, imagens publicadas)
Anterior: `2026-10-11-whatsapp-canal-design.md` (fase 1: escuta, gatilhos e triagem por IA)

## 1. Objetivo

Hoje, para ligar o WhatsApp, o dono do sistema precisa de terminal: criar a instância da
Evolution e gravar o webhook com `node -e fetch(...)`, inventar o segredo do webhook,
colar URL e chaves na tela e copiar o ID de cada grupo. Isso inviabiliza vender o sistema
(uma stack por cliente). Esta fase leva esses passos para dentro do sistema: o admin clica
em **Conectar / Reparar**, escaneia o QR e escolhe os grupos numa lista.

Entregas:

1. Chaves da Evolution vindas do **ambiente da stack** (sem colar na tela); instância
   sempre `os`; segredo do webhook **gerado pelo sistema**.
2. Serviço de provisionamento **idempotente** (`connect()`), com checklist por etapa.
3. Listagem dos **grupos da Evolution** para escolher na ficha do cliente.
4. **Frases de gatilho padrão** semeadas uma única vez.
5. Tela: cartão "Conexão com o WhatsApp" em Configurações > WhatsApp.
6. Documentação de deploy atualizada.

## 2. Fora do escopo

- Reconexão automática quando o aparelho cai; vários números/instâncias por stack;
  envio de mensagens (continua só leitura).
- A chave da Anthropic (conta do dono), escanear o QR, o aviso LGPD e preencher
  `EVOLUTION_API_KEY`/`EVOLUTION_DB_PASSWORD` ao subir a stack continuam manuais.
- Rodar o provisionamento sozinho no boot (rejeitado: esconde falhas e depende da ordem
  de subida da Evolution).

## 3. Configuração vinda do ambiente

- A stack passa ao serviço `backend` (além da Evolution) as variáveis
  `EVOLUTION_API_URL` (padrão `http://evolution-api:8080`) e `EVOLUTION_API_KEY`
  (a mesma que protege a Evolution), e `WEBHOOK_BASE_URL` (padrão `http://backend:3001`,
  a URL **interna** do backend que a Evolution chama). `portainer-stack.yml` e
  `docker-compose.yml` (dev; lá `WEBHOOK_BASE_URL` aponta para o host do backend visto
  de dentro do container da Evolution, p.ex. `http://host.docker.internal:3001`).
- `settings.keys.ts` → `ENV_FALLBACK`: `whatsapp.evolution.url → EVOLUTION_API_URL`,
  `whatsapp.evolution.apiKey → EVOLUTION_API_KEY`. **O ambiente prevalece**
  sobre o gravado na tela (a stack é a fonte da verdade); sem variável, vale o gravado. `describe()` já reporta
  `<key>Set` para segredos com fallback de ambiente.
- Instância: `whatsapp.evolution.instance` com **padrão `os`** no código quando vazio.
  A tela deixa de pedir.
- Segredo do webhook: no primeiro `connect()`, se `whatsapp.webhookSecret` estiver
  vazio, o backend gera 32 bytes hex (`crypto.randomBytes`) e grava pelo
  `SettingsService.set` (cifrado). O campo sai da tela; nunca é exibido. Se
  `APP_ENCRYPTION_KEY` não estiver definida, a etapa falha com mensagem clara.
- Na tela, os campos de URL/chave da Evolution só aparecem editáveis quando a variável
  de ambiente correspondente **não** existe; com ela, mostram "configurado pelo ambiente".

## 4. Serviço de provisionamento

`EvolutionProvisioningService.connect(): Promise<SetupReport>` com
`SetupReport = { steps: { id, label, ok, detail? }[], state, qr? }`. Etapas, em ordem,
parando na primeira que falhar e devolvendo o relatório até ali:

1. `reachable` — a Evolution responde (URL + `apikey` válidos). Falha: "Evolution
   inalcançável" / "chave recusada (HTTP 401)".
2. `instance` — a instância `os` existe; se não, cria
   (`POST /instance/create`, `integration: WHATSAPP-BAILEYS`, `qrcode: true`).
   Se já existe, não recria.
3. `webhook` — **sempre regrava** (`POST /webhook/set/os`): `url =
   ${WEBHOOK_BASE_URL}/api/whatsapp/webhook`, `byEvents:false`, `base64:false`,
   `headers: { "x-webhook-secret": <segredo> }`, `events: ["MESSAGES_UPSERT"]`.
4. `connection` — estado (`open` = pareado). Se não estiver `open`, devolve o QR
   (reaproveita `EvolutionStatusService.qr()`).

Idempotência: rodar `connect()` N vezes resulta no mesmo estado (instância única,
webhook regravado igual). Falha em uma etapa nunca deixa estado parcial incoerente (as
etapas são independentes e reexecutáveis).

> **Premissa de validação:** os caminhos e corpos acima (`/instance/create`,
> `/webhook/set/{instance}`, `/instance/connectionState`, `/instance/connect`,
> `/group/fetchAllGroups/{instance}`) foram lidos do código/`.env.example` da Evolution
> mas **nunca executados**. O usuário está rodando os passos manuais equivalentes agora;
> o plano usa exatamente os corpos que ele confirmar, e a primeira tarefa de
> implementação registra os formatos reais de resposta (inclusive o de "instância já
> existe" e o de `fetchAllGroups`). Divergência → ajustar o serviço, não o spec.

Rotas (`@Roles('ADMIN')`): `POST /whatsapp/connect` (executa e devolve o relatório) e
`GET /whatsapp/setup` (relatório do estado atual **sem** alterar nada: roda só as
checagens de leitura — alcançável, instância existe, webhook configurado se a Evolution
permitir consultar, estado). Segredos e a chave nunca aparecem nas respostas.

## 5. Grupos da Evolution

- `GET /whatsapp/evolution/groups` (`@Roles('ADMIN','AGENT')`) →
  `[{ id, name, size, linkedClientId?, linkedClientName? }]`, vindo de
  `GET /group/fetchAllGroups/os?getParticipants=false`. Cruza com `WhatsappGroup` para
  marcar os já cadastrados. Evolution fora do ar → 502 com mensagem clara (a tela cai no
  campo manual).
- Ficha do cliente > aba WhatsApp: botão **"Escolher da Evolution"** abre uma lista
  (busca por nome); ao escolher, preenche o ID (e o apelido com o nome do grupo) e o
  fluxo normal de "Adicionar grupo" segue. Grupos já vinculados a **outro** cliente
  aparecem desabilitados com o nome do cliente. Colar o ID à mão continua funcionando.

## 6. Frases de gatilho padrão

Semeadas em `prisma/seed.ts` (roda a cada boot, idempotente) **uma única vez**: o seed só
insere se a flag `whatsapp.defaultPhrasesSeeded` (linha em `Setting`, valor `true`) não
existir, e a grava ao terminar — assim uma frase que o admin apagar não volta no próximo
boot. Todas globais (`clientId` nulo), sem categoria:

| Frase | Prioridade |
|---|---|
| Sistema caiu | URGENT |
| Sem conexão | HIGH |
| Sem internet | HIGH |
| Wi-Fi caiu | HIGH |
| Servidor fora do ar | URGENT |
| Computador não liga | MEDIUM |
| Impressora parada | MEDIUM |
| Câmera offline | HIGH |
| Alarme disparado | URGENT |
| Cerca/portão parado | HIGH |

`phraseNorm` calculado com a mesma normalização do `normalizeText` (minúscula, sem
acento, espaços colapsados). Como `NULL` não conflita no índice único, a checagem de
duplicidade é por consulta (`findFirst`), não pelo índice.

## 7. Tela

Configurações > WhatsApp (só ADMIN), de cima para baixo:

1. **Cartão "Conexão com o WhatsApp"**: checklist das 4 etapas (✓ / ✗ / pendente, com o
   `detail` da falha), botão **Conectar / Reparar** (chama `POST /whatsapp/connect`),
   QR/código de pareamento quando o estado não for `open`, e o badge/aviso de
   desconexão que já existe. Ao abrir a aba, carrega `GET /whatsapp/setup`.
2. **Evolution (ambiente)**: URL e chave mostradas como "configurado pelo ambiente" ou
   editáveis se a variável faltar (comportamento da §3).
3. **IA** (chave da Anthropic, teto diário, retenção) e **frases padrão globais**:
   inalterados.

O campo "Segredo do webhook" e "Nome da instância" saem da tela.

## 8. Erros e riscos

- Evolution fora do ar / chave errada: etapa 1 falha com detalhe; nada é gravado.
- `connect()` concorrente (duplo clique): serializado por trava em memória por instância
  (single-tenant); a segunda chamada espera e devolve o relatório já pronto.
- Instância criada mas webhook falha: o relatório mostra instância ✓ / webhook ✗; novo
  clique repara.
- Segredo gerado e depois perdido (setting apagada): `connect()` gera outro e regrava o
  webhook — o par backend/Evolution volta a bater.
- API não oficial: mudanças da Evolution podem quebrar formatos; os testes unitários
  documentam os formatos esperados e a validação manual pós-deploy cobre a realidade.

## 9. Testes

- Unitários (`fetch` falso): cada etapa feliz; falha em cada etapa para o relatório certo;
  "instância já existe" não recria; webhook sempre regravado com URL/header/eventos
  exatos; segredo gerado só quando ausente e nunca devolvido; `connect()` repetido não
  duplica; concorrência serializada; listagem de grupos com marcação de já vinculados e
  502 quando a Evolution cai; `ENV_FALLBACK` (valor da tela > ambiente > padrão `os`).
- Seed: insere as 10 frases na primeira execução, não reinsere na segunda, não
  ressuscita uma frase apagada.
- Frontend: tsc + build; e2e leve (cartão aparece com o checklist; "Escolher da Evolution"
  abre a lista com `fetch`/rota interceptada pelo Playwright, sem Evolution real).
- Manual pós-deploy (obrigatório): clicar Conectar numa stack real, parear, escolher um
  grupo, mandar "Sistema caiu" e ver o chamado.

## 10. Ordem de construção

1. Validar/registrar os formatos reais da Evolution (insumo do usuário) e fixar o
   cliente HTTP da Evolution (`EvolutionClient`) usado por status, QR, provisionamento e
   grupos.
2. Configuração do ambiente: `ENV_FALLBACK`, instância padrão, variáveis na stack/compose.
3. `EvolutionProvisioningService` + rotas `connect`/`setup`.
4. Rota de grupos da Evolution.
5. Seed das frases padrão.
6. Frontend: cartão de conexão e seletor de grupos.
7. README de deploy, CHANGELOG e release 0.12.1 (que também carrega a correção pendente
   do erro de conexão da Anthropic, item parkeado da fase anterior).

## 11. Riscos conhecidos herdados

- Erros reais de conexão/timeout do SDK da Anthropic ainda contam tentativa (fix em 7).
- Backup lógico não cobre as tabelas do WhatsApp (task separada).
