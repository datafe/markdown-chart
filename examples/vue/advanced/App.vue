<script setup lang="ts">
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer } from '@datafe-open/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe-open/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import MarkdownIt from 'markdown-it';

const source = `# Sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["category", "value"],
    "source": [["A", 10], ["B", 20]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "category", "y": "value" } }]
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
