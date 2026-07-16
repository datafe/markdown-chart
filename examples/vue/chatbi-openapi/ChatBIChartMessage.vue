<script setup lang="ts">
import { computed } from 'vue';
import { MarkdownChart } from '@datafe/markdown-chart-vue';
import { createChatBIChartContext } from './chart-context';

const props = withDefaults(defineProps<{
  markdown: string;
  sessionId: string;
  requestId?: string;
  streaming?: boolean;
}>(), {
  streaming: false,
});

const chartContext = computed(() => createChatBIChartContext({
  sessionId: props.sessionId,
  ...(props.requestId ? { requestId: props.requestId } : {}),
}));
</script>

<template>
  <MarkdownChart
    :source="markdown"
    :streaming="streaming ?? false"
    :markdown-it="chartContext.markdownIt"
    :registry="chartContext.registry"
  />
</template>
