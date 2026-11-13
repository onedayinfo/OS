# Deploy — Portainer + Docker Hub

O `portainer-stack.yml` (na raiz) puxa as imagens `onedayinformatica/os-backend` e
`onedayinformatica/os-frontend` do Docker Hub. Toda config específica de cliente/domínio
vem de variáveis de ambiente — a mesma imagem serve qualquer instalação.

## 1. Publicar as imagens no Docker Hub

Numa máquina com Docker e acesso ao código:

```bash
docker login
./deploy/build-and-push.sh onedayinformatica 0.17.1
```

Publica `onedayinformatica/os-backend:0.17.1` + `:latest` e `onedayinformatica/os-frontend:0.17.1` + `:latest`.

### Instalador do agente Windows (MSI)

O MSI não fica no git. Antes do `build-and-push.sh`, no Windows:

```powershell
agent/instalador/build-msi.ps1
Copy-Item agent/instalador/saida/AgenteOS.msi backend/agent-dist/AgenteOS.msi
```

A imagem do backend leva a pasta `backend/agent-dist/` (rota `GET /clients/:id/agent/installer`,
caminho configurável por `AGENT_MSI_PATH`). Sem o arquivo, o botão "Baixar instalador" avisa que
ainda não foi publicado.

O arquivo baixado se chama `AgenteOS-<código>-<host>.msi`, com o domínio pelo qual o OS foi
acessado (cabeçalho `X-Forwarded-Host`, senão `Host`). Atrás do Cloudflare Tunnel o navegador
fala com o Next (container `frontend`), que repassa `/api` ao backend com `X-Forwarded-Host`
(o backend já confia em 1 hop de proxy, `trust proxy` em `main.ts`). Se o seu proxy não repassar
o host original, defina `PUBLIC_HOST=os.cliente.com.br` no backend; ela vence os cabeçalhos. Host
inválido ou ausente cai no nome `AgenteOS-<código>.msi`.

> Se o servidor do Portainer for `linux/amd64` e você builda noutra arquitetura,
> edite o script para incluir `--platform linux/amd64` nos `docker build`.

## 2. Criar o stack no Portainer

**Opção A — Repository (recomendado):**
Stacks → Add stack → Repository → URL `https://github.com/onedayinfo/OS`,
branch `main`, Compose path `portainer-stack.yml`. Preencha as variáveis
(seção abaixo) em "Environment variables". Toda atualização = "Pull and redeploy".

**Opção B — Web editor:** cole o conteúdo de `portainer-stack.yml` e preencha as
variáveis em "Environment variables".

### Variáveis (ver `deploy/stack.env.example`)

Obrigatórias: `APP_URL`, `PORTAL_URL` (mesmo domínio, sem barra final),
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, `JWT_ACCESS_SECRET`,
`JWT_REFRESH_SECRET`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `MAIL_FROM`.
Gere segredos com `openssl rand -hex 32`.

Obrigatória também: `CLOUDFLARE_TUNNEL_TOKEN` (passo 3).

Obrigatória a partir da 0.2.0: `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`) —
criptografa os segredos configurados em `/app/config`. Sem ela o sistema sobe e
usa o `.env` legado como fallback, mas não deixa salvar segredos pela UI.

Opcionais: `OS_TAG` (default `latest`), `COOKIE_SAMESITE`/`COOKIE_SECURE`
(default `lax`/`true`). `RESEND_API_KEY`/`RESEND_INBOUND_SECRET`/`MAIL_FROM` e
`STORAGE_PATH` viram legado/fallback — o recomendado é configurar em
`/app/config` (abas E-mail e Armazenamento).

## 3. Cloudflare Tunnel (sem expor portas)

O stack **não publica nenhuma porta** — o serviço `cloudflared` abre um túnel de
saída para a Cloudflare e serve o sistema pelo seu domínio. O servidor Next
encaminha `/api/*` para o backend na rede interna, então front e API ficam na
mesma origem (`https://<APP_URL>`).

1. Zero Trust → **Networks → Tunnels → Create a tunnel** → *Cloudflared* → dê um
   nome (ex.: `os`).
2. Copie o **token** (a tela mostra um `docker run ... --token eyJ...`; use só o
   valor do token) e ponha em `CLOUDFLARE_TUNNEL_TOKEN` nas variáveis do stack.
3. Ainda no túnel, **Public Hostnames → Add a public hostname**:
   - Subdomain/Domain: o mesmo host de `APP_URL` (ex.: `os` + `SEU_DOMINIO.com.br`)
   - Type: `HTTP` · URL: `frontend:3000`
   - (só esse — não precisa de rota para `/api`, o Next resolve internamente)
4. Suba/atualize o stack no Portainer. O DNS é criado pela Cloudflare
   automaticamente; em segundos `https://<APP_URL>` responde.

Sem domínio ainda? Dá para testar com um hostname `*.trycloudflare` gerado pelo
próprio túnel, ou adicionar temporariamente `ports: ["127.0.0.1:3000:3000"]` ao
serviço `frontend` e acessar por `http://IP-DO-SERVIDOR:3000` (aí o cookie
precisa de `COOKIE_SECURE=false`).

### Webhook de e-mail de entrada (opcional)

Para abrir chamados por e-mail (todo o passo é feito em Config > E-mail e no painel do Resend):

1. No Resend, em **Domains**, ative **Receiving** no domínio (ou num subdomínio, ex.:
   `suporte.suaempresa.com.br`) e crie no DNS o registro **MX** que ele mostrar. Sem
   domínio próprio, dá para testar com o endereço `<id>.resend.app` da aba Receiving.
2. No Resend, em **Webhooks**, crie um webhook para
   `https://<APP_URL>/api/webhooks/resend/inbound` com o evento **`email.received`**.
3. Copie o **Signing secret** (`whsec_…`) do webhook e cole em Config > E-mail >
   "Segredo de assinatura do webhook". A assinatura é verificada no padrão Svix.
4. A **chave da API** em Config > E-mail precisa de **Full access** (uma chave só de
   envio não lê os e-mails recebidos): o webhook só traz o `email_id`; corpo e anexos
   são buscados na API do Resend.

Remetente cadastrado como contato → chamado no cliente dele; domínio em "Domínios de
e-mail" do cliente → contato novo (inativo) + chamado; desconhecido → fila de triagem.
Resposta com `[#AAAA-NNNN]` no assunto vira comentário no chamado.

### Rate limiting

O backend limita por IP as rotas `/api/auth/login` + `/api/auth/set-password`
(10/min combinados) e `/api/auth/forgot-password` (5/min). Atrás do Cloudflare
Tunnel o IP real chega em `CF-Connecting-IP` (fallback `X-Forwarded-For`); com o
`trust proxy=1` já configurado não há nada a ajustar. Store em memória — uma
topologia multi-instância exigiria store compartilhado (Redis).

## 4. Primeiro acesso

No 1º boot o backend roda `prisma migrate deploy` + seed idempotente (cria o
admin de `SEED_ADMIN_*`, políticas de SLA e categorias) e sobe. Acesse
`https://<APP_URL>/app/login` com as credenciais do `SEED_ADMIN_*`.

## Atualizar

```bash
./deploy/build-and-push.sh onedayinformatica <nova-tag>
```

No Portainer: ajuste `OS_TAG` e "Pull and redeploy" (ou "Update the stack" com
*re-pull image*). As migrations rodam sozinhas no boot.

> Ao subir para a **0.2.0**: adicione `APP_ENCRYPTION_KEY` às variáveis do stack
> **antes** do redeploy. Sem ela o backend sobe, mas a aba de Configurações não
> salva segredos.

## Domínios separados (front e API em hosts diferentes)

Gere o frontend com a URL da API embutida:

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=https://api-os.SEU_DOMINIO.com.br/api \
  -t onedayinformatica/os-frontend:0.1.0-<cliente> ./frontend
```

e no stack: `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `APP_URL`/`PORTAL_URL`
com o domínio do front.

## WhatsApp (Evolution API)

O stack inclui `evolution-api`, `evolution-db` (Postgres próprio) e
`evolution-redis`. A Evolution **não expõe porta no host**: só o backend a
alcança, em `http://evolution-api:8080`. Ela não guarda mensagens (o OS é o dono
do histórico).

1. Variáveis da stack: `EVOLUTION_API_KEY` (obrigatória; `openssl rand -hex 32`) e
   `EVOLUTION_DB_PASSWORD` (obrigatória; só letras/números, pois entra numa URL).
   Opcionais: `EVOLUTION_API_URL` (padrão `http://evolution-api:8080`) e
   `WEBHOOK_BASE_URL` (padrão `http://backend:3001`); os padrões servem à stack
   padrão. O ambiente prevalece sobre o que estiver salvo na tela.
2. Depois do redeploy: **Configurações > WhatsApp > Conectar / Reparar**. O OS cria a
   instância e o webhook (com segredo gerado) sozinho e mostra um checklist
   (Evolution alcançável, Instância criada, Webhook configurado, WhatsApp pareado).
   Escaneie o QR no celular **dedicado**; o estado atualiza sozinho.
3. Em Configurações > WhatsApp, informe a chave da API da Anthropic e salve.
4. Em cada cliente, aba WhatsApp: **Escolher da Evolution** para vincular o grupo
   (lista com busca) e **Aplicar frases padrão**. A primeira vez que a lista abre pode
   levar cerca de 1 minuto (a Evolution demora para listar os grupos); depois fica em cache.
5. As frases de gatilho padrão (10) já vêm cadastradas, uma única vez
   (Configurações > WhatsApp > Frases de gatilho padrão).
6. Se algo falhar, o checklist mostra a etapa e o motivo; clique em **Conectar /
   Reparar** de novo. Se nenhuma mensagem chegar, confira a etapa "Webhook
   configurado" e procure respostas 401 em `docker logs` do backend (segredo do
   webhook divergente: clique em Conectar / Reparar). Os antigos comandos `node -e`
   não são mais necessários.
7. Avisos: API não oficial (risco de banimento do número que escuta — use chip
   separado, somente leitura); LGPD (avise os participantes; o texto vai para a
   API da Anthropic).
