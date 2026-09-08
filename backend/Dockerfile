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
# client Prisma vem do builder logo abaixo; sem scripts aqui.
RUN npm ci --omit=dev --ignore-scripts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
