# React + ChatBI OpenAPI 示例

本示例用于渲染 ChatBI 返回的流式 Markdown。第三方应用只需提供一个回调，
返回原始 CSV `ArtifactContent`：

```tsx
const resolveLegacyArtifactContent = createChatBIArtifactContentResolver({
  sessionId,
  requestId,
});

<MarkdownChart
  source={markdown}
  streaming={streaming}
  resolveLegacyArtifactContent={resolveLegacyArtifactContent}
/>
```

组件内部负责有界 CSV 解析、临时图表 source 净化、在具有唯一不透明源
（opaque origin）的 bootstrap iframe 内使用 Dedicated Worker 完成转换、JSON 校验
和内联数据物化。宿主应用既不解析 CSV，也不执行图表 source。

本示例中经过记忆化的 resolver 会在 `sessionId` 或 `requestId` 变化时改变引用
身份，使组件能够安全地使已完成的图表失效。如果应用会在无关的重新渲染中创建
语义相同的新回调，可以传入稳定且已弃用的 `legacyArtifactContextKey`；未传入该
参数时，回调的引用身份就是缓存边界。

只要能够获得当前 `requestId`，就应将其传入。它会把 artifact 查找范围限制在当前
ChatBI 请求内。未传入时，List 操作会搜索整个会话，因而可能无法区分同名的历史
artifact。

## 浏览器到后端的契约

第三方后端只暴露两个同源路由：

| 浏览器端点 | 后端职责 |
| --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | 完成签名并调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，然后转发 JSON-RPC 响应。 |
| `POST /api/dataworks/get-agent-session-artifact-meta` | 完成签名并调用 [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta)，然后转发 JSON-RPC 响应。 |

该辅助函数会遍历 List 分页，要求恰好匹配一个 artifact，使用
`SessionId + ArtifactPath` 调用 Get，并原样返回 `ArtifactContent`。AccessKey
凭证和签名逻辑必须保留在后端。代理应在缓冲内容前完成鉴权并限制响应大小；
组件在浏览器侧的限制是第二道防线。

提供上述两个路由后，运行示例：

```sh
pnpm --filter @datafe/markdown-chart-example-react-chatbi-openapi dev
```
