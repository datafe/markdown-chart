import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@datafe/markdown-chart': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@datafe/markdown-chart-echarts': fileURLToPath(new URL('./packages/echarts/src/index.ts', import.meta.url)),
      '@datafe/markdown-chart-markdown-it': fileURLToPath(new URL('./packages/markdown-it/src/index.ts', import.meta.url)),
    },
  },
});
