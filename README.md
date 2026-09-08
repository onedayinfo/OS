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
