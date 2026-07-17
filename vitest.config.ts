import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@datafe-open/markdown-chart': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@datafe-open/markdown-chart-echarts': fileURLToPath(new URL('./packages/echarts/src/index.ts', import.meta.url)),
      '@datafe-open/markdown-chart-markdown-it': fileURLToPath(new URL('./packages/markdown-it/src/index.ts', import.meta.url)),
      '@datafe-open/markdown-chart-react': fileURLToPath(new URL('./packages/react/src/index.tsx', import.meta.url)),
      '@datafe-open/markdown-chart-vue': fileURLToPath(new URL('./packages/vue/src/index.ts', import.meta.url)),
    },
  },
});
