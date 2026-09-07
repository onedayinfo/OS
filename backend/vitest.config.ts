import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [
    tsconfigPaths(),
    // Emite metadata dos decorators (emitDecoratorMetadata) para a DI do Nest
    // funcionar em teste. Receita oficial NestJS + vitest.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Mantém os defaults do vitest e tira os alvos que exigem Postgres no ar.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.integration.spec.ts',
      '**/*.e2e-spec.ts',
    ],
  },
});
