# Vue + markdown-it + ChatBI OpenAPI example

This runnable Vue 3 example renders streaming Markdown returned by ChatBI while
keeping the application's existing markdown-it pipeline. The reusable
`ChatBIChartMessage.vue` rebuilds its parser and renderer context only when the
artifact lookup scope changes:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe/markdown-chart-vue';
import MarkdownIt from 'markdown-it';
import { createChatBIArtifactContentResolver } from './data';

const props = defineProps<{
  markdown: string;
  sessionId: string;
  requestId?: string;
  streaming?: boolean;
}>();

const context = computed(() => {
  const resolveLegacyArtifactContent = createChatBIArtifactContentResolver({
    sessionId: props.sessionId,
    ...(props.requestId ? { requestId: props.requestId } : {}),
  });
  const registry = new ChartRendererRegistry().register(createEChartsRenderer({
    resolveLegacyArtifactContent,
  }));
  const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
    registry,
  });
  return { registry, markdownIt };
});
</script>

<template>
  <MarkdownChart
    :source="markdown"
    :streaming="streaming ?? false"
    :markdown-it="context.markdownIt"
    :registry="context.registry"
  />
</template>
```

The callback returns raw CSV `ArtifactContent`. The renderer owns bounded CSV
parsing, temporary source sanitization and sandboxed conversion, JSON
validation, and inline data materialization. This example never parses CSV or
executes chart source in the application window.

Keep the `registry` and `markdownIt` instances stable while text is appended to
one stream: completed chart blocks are then reused. Rebuild both when
`sessionId` or `requestId` changes so cached artifact data cannot cross ChatBI
contexts. Pass the current `requestId` whenever available; session-wide lookup
can otherwise find an old artifact with the same name.

## Browser-to-backend contracts

The third-party backend exposes only two same-origin routes:

| Browser endpoint | Backend responsibility |
| --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | Authorize, sign, and call [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts), then forward the JSON-RPC response. |
| `POST /api/dataworks/get-agent-session-artifact-meta` | Authorize, sign, and call [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta), then forward the JSON-RPC response. |

The local helper follows List pagination, requires exactly one artifact named
for the requested job, calls Get with `SessionId + ArtifactPath`, and returns
`ArtifactContent` unchanged. Keep AccessKey credentials and signing on the
backend, and enforce authorization and response-size limits there.

Run the example after providing both routes:

```sh
pnpm --filter @datafe/markdown-chart-example-vue-chatbi-openapi dev
```

The ArtifactContent resolver and temporary renderer adapter are deprecated
migration code. They are isolated in this dedicated example and the ECharts
package's `legacy/` directory so they can be deleted together after ChatBI
stops emitting the legacy stream format. Canonical `markdown-chart` support and
the ordinary Vue/markdown-it examples do not depend on them.
