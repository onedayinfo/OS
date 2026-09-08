# Deploy — Portainer + Docker Hub

O `portainer-stack.yml` (na raiz) puxa as imagens `onedayinfo/os-backend` e
`onedayinfo/os-frontend` do Docker Hub. Toda config específica de cliente/domínio
vem de variáveis de ambiente — a mesma imagem serve qualquer instalação.

## 1. Publicar as imagens no Docker Hub

Numa máquina com Docker e acesso ao código:

```bash
docker login
./deploy/build-and-push.sh onedayinfo 0.1.0
```

Publica `onedayinfo/os-backend:0.1.0` + `:latest` e `onedayinfo/os-frontend:0.1.0` + `:latest`.

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

Opcionais: `OS_TAG` (default `latest`), `BACKEND_PORT`/`FRONTEND_PORT` (3001/3000),
`COOKIE_SAMESITE`/`COOKIE_SECURE` (default `lax`/`true`),
`RESEND_API_KEY`/`RESEND_INBOUND_SECRET` (sem elas o sistema roda, mas não envia
e-mail).

## 3. Proxy reverso

O stack expõe as portas só em `127.0.0.1`. Aponte seu proxy (Traefik / Nginx
Proxy Manager) do host para:

| Rota pública | Destino |
|---|---|
| `https://<APP_URL>/api` | `127.0.0.1:${BACKEND_PORT}` (3001) |
| `https://<APP_URL>/` | `127.0.0.1:${FRONTEND_PORT}` (3000) |

O proxy termina o TLS. Como front e API ficam no mesmo domínio, o cookie de
refresh funciona com `COOKIE_SAMESITE=lax`.

### Webhook de e-mail de entrada (opcional)

Se for usar recebimento de chamado por e-mail, aponte o MX do subdomínio de
suporte para o Resend e configure o webhook dele para
`https://<APP_URL>/api/webhooks/resend/inbound` com o mesmo `RESEND_INBOUND_SECRET`.
(Nota: a validação de assinatura hoje é HMAC simples; o Resend usa Svix —
trocar antes de ligar em produção.)

## 4. Primeiro acesso

No 1º boot o backend roda `prisma migrate deploy` + seed idempotente (cria o
admin de `SEED_ADMIN_*`, políticas de SLA e categorias) e sobe. Acesse
`https://<APP_URL>/app/login` com as credenciais do `SEED_ADMIN_*`.

## Atualizar

```bash
./deploy/build-and-push.sh onedayinfo <nova-tag>
```

No Portainer: ajuste `OS_TAG` e "Pull and redeploy" (ou "Update the stack" com
*re-pull image*). As migrations rodam sozinhas no boot.

## Domínios separados (front e API em hosts diferentes)

Gere o frontend com a URL da API embutida:

```bash
docker build --build-arg NEXT_PUBLIC_API_URL=https://api-os.SEU_DOMINIO.com.br/api \
  -t onedayinfo/os-frontend:0.1.0-<cliente> ./frontend
```

e no stack: `COOKIE_SAMESITE=none`, `COOKIE_SECURE=true`, `APP_URL`/`PORTAL_URL`
com o domínio do front.
