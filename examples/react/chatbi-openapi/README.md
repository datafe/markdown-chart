# React + ChatBI OpenAPI 示例

本示例用于渲染 ChatBI 返回的流式 Markdown。宿主把既有的两个同源 OpenAPI
代理路由适配为 `LegacySandboxTransport`，公共 client 负责文件匹配、重试、
request scope 到 session-only 的 fallback、成功缓存和 live waiting：

```tsx
const transport = useMemo(() => createChatBILegacySandboxTransport(), []);
const client = useMemo(
  () => createLegacySandboxClient({ transport }),
  [transport, cacheScopeKey],
);
const legacySandbox = useMemo(() => client.bind({
  sessionId,
  ...(requestId ? { requestId } : {}),
  phase: streaming ? 'live' : 'final',
  cacheScopeKey,
}), [client, sessionId, requestId, streaming, cacheScopeKey]);
const echarts = useMemo(() => ({ legacySandbox }), [legacySandbox]);
const deferredMarkdown = useMemo(
  () => replaceDeferredLegacyFences(markdown, legacySandbox.shouldDefer),
  [markdown, legacySandbox],
);

<MarkdownChart source={deferredMarkdown.source} streaming={streaming} echarts={echarts} />
```

transport 在组件生命周期内保持稳定；`client` 在当前认证主体内保持稳定，
`cacheScopeKey` 变化时重建，session/request/phase 变化只重新 `bind`。
`cacheScopeKey` 是必填的非 secret 主体标识，推荐 `${tenantId}:${userId}`。不得使用
token、cookie、session secret 的原文或 hash，也不得回退为 `sessionId`。登录身份变化
时新的 client/registry 会让既有 chart controller 取消旧请求；A → B → A 也不会复用
第一次 A 的 success cache。

live 阶段尚无 `requestId` 时，组件只对 Markdown 中实际出现的 query / sandbox-filepath
legacy fence 调用 `binding.shouldDefer(rawLanguage)`。每个已闭合的命中 fence 单独替换为
中性 waiting Markdown，并在消息容器标记 `aria-busy=true`；同一消息的正文、普通代码、
canonical/compact chart 和其他非命中 block 继续渲染，且不发 legacy List/Get 请求。
`requestId` 到达后 source 恢复原始 fence 并正常 mount。真实 transport/renderer 错误
仍按框架错误路径上报。predicate 使用与 core 一致的 lowercase language；顶层、
blockquote、bullet / ordered-list container 的合法 fence 都按 block 处理，未闭合 fence
保持原文并继续使用框架既有 streaming 语义。

新接入应使用 `createLegacySandboxClient` + `legacySandbox`。已弃用的
`resolveLegacyArtifactContent` / `resolveLegacySandboxFileContent` 仅用于尚未迁移的旧
宿主；不要与 `legacySandbox` 同时配置。

## 浏览器到后端的契约

第三方后端继续只暴露两个同源路由，端点与参数没有变化：

| 浏览器端点 | 请求参数 | 后端职责 |
| --- | --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | `SessionId`、可选 `RequestId`、`MaxResults`、可选 `NextToken` | 完成鉴权/签名并调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，转发 JSON-RPC 响应。 |
| `POST /api/dataworks/get-agent-session-artifact-meta` | `SessionId`、`ArtifactPath` | 完成鉴权/签名并调用 [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta)，转发 JSON-RPC 响应。 |

`data.ts` 只遍历 List 分页、映射 descriptor、读取 raw `ArtifactContent` 并把 HTTP /
网络 / envelope 错误分类。它不复制 matching、retry、fallback 或 cache。AccessKey、
Caller-Context、cookie 和签名逻辑必须留在后端/宿主；代理应先鉴权并限制响应大小，
浏览器的 8 MiB 上限是第二道防线。`AbortSignal` 会原样传递给两个 fetch。

提供上述路由后运行：

```sh
pnpm --filter @datafe-open/markdown-chart-example-react-chatbi-openapi dev
```
