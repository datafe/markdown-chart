<script setup lang="ts">
import { MarkdownChart } from '@datafe/markdown-chart-vue';

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
</script>

<template>
  <MarkdownChart :source="source" />
</template>
