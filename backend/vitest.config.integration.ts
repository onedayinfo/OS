import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

// Alvo de integração: specs que exigem Postgres no ar
// (`docker compose up -d postgres`). Sem o banco, o bloco pula com aviso.
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.integration.spec.ts'],
  },
});
