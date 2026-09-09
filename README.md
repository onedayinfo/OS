# Sistema de OS

Sistema de chamados / ordens de serviço para empresa de informática.

## Pré-requisitos

- Node 20
- Docker

## Como rodar (desenvolvimento)

```bash
cp .env.example backend/.env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

Aplicação disponível em http://localhost:3000

## Configurações no app

A partir da 0.2.0, credenciais do Resend, armazenamento S3, aparência (logo,
nome, cor) e backup dos dados são configurados em **`/app/config`** (abas
visíveis só para `ADMIN`) — não mais no `.env`.

- Defina **`APP_ENCRYPTION_KEY`** (`openssl rand -base64 32`) no ambiente do
  backend. É obrigatória para salvar segredos pela UI; sem ela o sistema sobe e
  usa o `.env` legado como fallback.
- `RESEND_API_KEY`, `MAIL_FROM`, `RESEND_INBOUND_SECRET` e `STORAGE_PATH`
  continuam funcionando como fallback enquanto o banco não tiver o valor.
- **Backup/restauração:** a aba Backup baixa um JSON com todos os dados e
  permite restaurar (apaga tudo e regrava). Restaurar em outro servidor exige a
  **mesma `APP_ENCRYPTION_KEY`** para os segredos voltarem a funcionar.

## Testes

```bash
cd backend
npm test              # unit, 100% offline (sem Postgres)
npm run test:integration   # exige Postgres no ar: docker compose up -d postgres
```

`npm run test:integration` sem Postgres no ar não quebra — pula com aviso (exit 0).

## Estrutura

- `backend/` — API NestJS + Prisma
- `frontend/` — Next.js (App Router)
- `docker-compose.yml` — produção
- `docker-compose.dev.yml` — override de desenvolvimento (hot reload)
