<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe/markdown-chart-vue';

const registry = new ChartRendererRegistry().register(createEChartsRenderer({
  loadECharts: () => import('echarts'),
}));
const md = new MarkdownIt({ html: false }).use(markdownChartPlugin, { registry });

const source = `# Sales

\`\`\`chart
{
  "version": 1,
  "renderer": "echarts",
  "spec": {
    "xAxis": { "type": "category", "data": ["A", "B"] },
    "yAxis": {},
    "series": [{ "type": "bar", "data": [10, 20] }]
  }
}
\`\`\``;
</script>

<template>
  <MarkdownChart
    :source="source"
    :markdown-it="md"
    :registry="registry"
  />
</template>

<style>
.markdown-chart-placeholder { min-height: 360px; }
</style>
