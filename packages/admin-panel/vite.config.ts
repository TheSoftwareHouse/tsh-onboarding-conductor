import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Material Symbols ship as one SVG per icon (see `src/components/ui/icons.ts`).
    // `dimensions: false` drops the file's 48px width/height so a Tailwind size class decides,
    // and `fill: currentColor` is set once here rather than at every use.
    svgr({ svgrOptions: { dimensions: false, svgProps: { fill: 'currentColor' } } }),
  ],
  envDir: '../..',
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
});
