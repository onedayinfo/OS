# Deploy — Portainer + Docker Hub

O `portainer-stack.yml` (na raiz) puxa as imagens `onedayinformatica/os-backend` e
`onedayinformatica/os-frontend` do Docker Hub. Toda config específica de cliente/domínio
vem de variáveis de ambiente — a mesma imagem serve qualquer instalação.

## 1. Publicar as imagens no Docker Hub

Numa máquina com Docker e acesso ao código:

```bash
docker login
./deploy/build-and-push.sh onedayinformatica 0.11.0
```

Publica `onedayinformatica/os-backend:0.11.0` + `:latest` e `onedayinformatica/os-frontend:0.11.0` + `:latest`.

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

Se for usar recebimento de chamado por e-mail, aponte o MX do subdomínio de
suporte para o Resend e configure o webhook dele para
`https://<APP_URL>/api/webhooks/resend/inbound` com o mesmo `RESEND_INBOUND_SECRET`.
(Nota: a validação de assinatura hoje é HMAC simples; o Resend usa Svix —
trocar antes de ligar em produção.)

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
