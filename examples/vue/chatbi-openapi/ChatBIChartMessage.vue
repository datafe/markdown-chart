<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import { useChatBIChartMessageLifecycle } from './chart-context';
import { createChatBILegacySandboxTransport } from './data';

const props = withDefaults(defineProps<{
  markdown: string;
  sessionId: string;
  requestId?: string;
  streaming?: boolean;
  cacheScopeKey: string;
}>(), {
  streaming: false,
});

const transport = createChatBILegacySandboxTransport();
const { chartContext, renderSource, deferredCount } = useChatBIChartMessageLifecycle({
  markdown: () => props.markdown,
  sessionId: () => props.sessionId,
  requestId: () => props.requestId,
  streaming: () => props.streaming,
  cacheScopeKey: () => props.cacheScopeKey,
}, transport);
</script>

<template>
  <div
    :aria-busy="deferredCount > 0 || undefined"
    :data-chatbi-legacy-chart-pending="deferredCount > 0 ? 'true' : undefined"
  >
    <MarkdownChart
      :source="renderSource"
      :streaming="streaming ?? false"
      :markdown-it="chartContext.markdownIt"
      :registry="chartContext.registry"
    />
  </div>
</template>
