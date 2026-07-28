<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import { createLegacySandboxHostAdapter } from '@datafe-open/markdown-chart-echarts';
import { useChatBIChartMessageLifecycle } from './chart-context';
import { createChatBILegacySandboxTransport } from './data';

const props = withDefaults(defineProps<{
  markdown: string;
  sessionId: string;
  requestId: string;
  streaming?: boolean;
  cacheScopeKey: string;
}>(), {
  streaming: false,
});

const transport = createChatBILegacySandboxTransport();
const hostAdapter = createLegacySandboxHostAdapter({ transport });
const { chartContext } = useChatBIChartMessageLifecycle({
  sessionId: () => props.sessionId,
  requestId: () => props.requestId,
  streaming: () => props.streaming,
  cacheScopeKey: () => props.cacheScopeKey,
}, hostAdapter);
</script>

<template>
  <MarkdownChart
    :source="markdown"
    :streaming="streaming ?? false"
    :markdown-it="chartContext.markdownIt"
    :registry="chartContext.registry"
  />
</template>
