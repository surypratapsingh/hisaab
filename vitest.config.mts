import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Threads, as vitest 1 used, and at most 4 at once: with one worker per file (51) the
    // timing budgets in client, integration and encryption tests went over their limits.
    pool: 'threads',
    maxWorkers: 4,
    server: {
      // Vite's builtin list predates node:sqlite, so it tries to resolve it
      // from disk unless it is marked external.
      deps: { external: [/^node:sqlite$/] },
    },
  },
  ssr: {
    external: ['node:sqlite'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
