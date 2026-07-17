# Vue + markdown-it + ChatBI OpenAPI 示例

这个可直接运行的 Vue 3 示例在保留应用现有 markdown-it 处理链路的同时，渲染
ChatBI 返回的流式 Markdown。可复用的 `ChatBIChartMessage.vue` 只会在 artifact
查找范围变化时重建解析器和渲染上下文：

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

回调返回原始 CSV `ArtifactContent`。渲染器内部负责有界 CSV 解析、临时图表 source
净化和沙箱转换、JSON 校验以及内联数据物化。本示例不会在应用窗口中解析 CSV 或
执行图表 source。

向同一个流追加文本时，应保持 `registry` 和 `markdownIt` 实例稳定，以便复用
已完成的图表块。`sessionId` 或 `requestId` 变化时，应同时重建这两个实例，避免
缓存的 artifact 数据跨越 ChatBI 上下文。只要能够获得当前 `requestId`，就应将其
传入；否则会话级查找可能命中同名的历史 artifact。

## 浏览器到后端的契约

第三方后端只暴露两个同源路由：

| 浏览器端点 | 后端职责 |
| --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | 完成鉴权和签名，调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，然后转发 JSON-RPC 响应。 |
| `POST /api/dataworks/get-agent-session-artifact-meta` | 完成鉴权和签名，调用 [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta)，然后转发 JSON-RPC 响应。 |

本地辅助函数会遍历 List 分页，要求恰好存在一个以所请求 job 命名的 artifact，使用
`SessionId + ArtifactPath` 调用 Get，并原样返回 `ArtifactContent`。AccessKey 凭证
和签名逻辑应保留在后端，鉴权与响应大小限制也应由后端执行。

提供上述两个路由后，运行示例：

```sh
pnpm --filter @datafe/markdown-chart-example-vue-chatbi-openapi dev
```

`ArtifactContent` resolver 和临时渲染器适配器都是已弃用的迁移代码。它们被隔离
在这个专用示例和 ECharts 包的 `legacy/` 目录中；ChatBI 停止输出 legacy 流格式后，
可以将二者一并删除。canonical `markdown-chart` 支持以及普通的 Vue/markdown-it
示例都不依赖这些代码。
