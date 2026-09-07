import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

// O globalSetup semeia um contato de teste direto no banco. Ele usa o
// PrismaClient do backend, que lê DATABASE_URL do ambiente — carregamos aqui a
// partir de backend/.env (o mesmo banco que a API usa).
if (process.env.DATABASE_URL === undefined) {
  const env = readFileSync(resolve(process.cwd(), '../backend/.env'), 'utf8');
  const m = env.match(/^\s*DATABASE_URL\s*=\s*(.*)$/m);
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, '');
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/seed-e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  // Sobe só o frontend (npm run start, produção). O operador deixa backend
  // (npm run start) e Postgres no ar antes de rodar. reuseExistingServer evita
  // conflito se o frontend já estiver de pé.
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
