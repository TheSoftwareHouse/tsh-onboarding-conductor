import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Resolves to `@tsh/ddl-schema`'s TypeScript source, the way `@tsh/shared` and
      // `@tsh/openapi` already do in `tsconfig.base.json`. Vite compiles it like any other
      // source file, so the panel needs no build of that package and cannot race the engine's
      // typecheck, which rebuilds its `dist`.
      '@tsh/ddl-schema': fileURLToPath(new URL('../shared/ddl-schema/src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.spec.ts', 'src/types/**', 'src/main.tsx'],
    },
  },
});
