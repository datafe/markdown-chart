<script setup lang="ts">
import { MarkdownChart } from '@datafe/markdown-chart-vue';

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
</script>

<template>
  <MarkdownChart :source="source" />
</template>
