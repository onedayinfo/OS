# build
FROM node:20-alpine AS builder
WORKDIR /app
# npm 10 (bundled no node:20/22-alpine) rejeita o package-lock.json gerado pelo
# npm 11 ("Missing: magicast@0.3.5 / typescript@5.9.3 from lock file"). Alinha o npm.
RUN npm i -g npm@11
COPY package*.json ./
# --ignore-scripts: o postinstall (prisma generate) roda antes de o schema ser
# copiado; a geração explícita abaixo cobre o build.
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm i -g npm@11
COPY package*.json ./
COPY prisma ./prisma
# Deps de produção (inclui a CLI do Prisma e o tsx). Os scripts rodam: o
# postinstall gera o client Prisma (schema já presente) e o esbuild do tsx
# baixa seu binário nativo — necessário para `prisma db seed`.
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
EXPOSE 3001
# Aplica migrations, roda o seed idempotente (admin, políticas de SLA e
# categorias) e sobe a API. Sem SEED_ADMIN_* o seed apenas pula o admin.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]
