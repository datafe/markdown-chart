<script setup lang="ts">
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe/markdown-chart-vue';
import MarkdownIt from 'markdown-it';

const source = `# Sales

\`\`\`markdown-chart
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

const registry = new ChartRendererRegistry().register(createEChartsRenderer());
const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
  registry,
});
</script>

<template>
  <MarkdownChart
    :source="source"
    :markdown-it="markdownIt"
    :registry="registry"
  />
</template>
