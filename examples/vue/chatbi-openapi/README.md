# Vue + markdown-it + ChatBI OpenAPI 示例

本示例保留宿主的 markdown-it 处理链路，同时把既有两个同源 OpenAPI 代理路由
适配为 `LegacySandboxTransport`。`ChatBIChartMessage.vue` 与测试共用
`useChatBIChartMessageLifecycle`：transport 与 host adapter 在 setup 生命周期内稳定，
adapter 以 `identity(context)` / `bind(context)` 管理 principal/session/request/phase：

```ts
const transport = createChatBILegacySandboxTransport();
const hostAdapter = createLegacySandboxHostAdapter({ transport });
const { chartContext, renderSource, deferredCount } = useChatBIChartMessageLifecycle({
  markdown: () => props.markdown,
  sessionId: () => props.sessionId,
  requestId: () => props.requestId,
  streaming: () => props.streaming,
  cacheScopeKey: () => props.cacheScopeKey,
}, hostAdapter);
```

模板把 `chartContext.markdownIt` 和 `chartContext.registry` 交给 `<MarkdownChart>`。公共 client
负责唯一匹配、重试、request → session-only fallback、成功缓存和 live waiting；
example 的 `data.ts` 只负责 OpenAPI transport。

`cacheScopeKey` 是调用方显式传入的必填非 secret 主体标识，推荐
`${tenantId}:${userId}`。不得使用 token/cookie/session secret 的原文或 hash，也不得
回退为 `sessionId`。认证主体变化会创建新的 client/registry，让旧 chart controller
按既有 Abort 生命周期取消；A → B → A 的第三次 A 会重新 List/Get，不会复用第一次
A 的 success cache。

live 阶段尚无 `requestId` 时，lifecycle 对每个已闭合 query / sandbox-filepath legacy
fence 消费 `binding.shouldDefer(rawLanguage)`，只把命中 fence 替换为中性 waiting
Markdown，并用 `deferredCount` 在消息容器标记 `aria-busy=true`。同一消息中的正文、
普通代码、canonical/compact chart 和其他非命中 block 继续由 `<MarkdownChart>` 渲染，
legacy List/Get 保持零网络且无 error UI；`requestId` 到达后 `renderSource` 恢复原文。
真实 resolver/transport 错误不会被这个 gate 吞掉。predicate 使用与 core 一致的
lowercase language；顶层、blockquote、bullet / ordered-list container 的合法 fence
都按 block 处理，未闭合 fence 保持原文并继续使用框架既有 streaming 语义。

新接入应使用 `createLegacySandboxHostAdapter` +
`createEChartsRenderer({ legacySandbox })`。
已弃用的 raw-content callbacks 仅用于旧迁移路径，不能与 binding 混用。

## 浏览器到后端的契约

| 浏览器端点 | 请求参数 | 后端职责 |
| --- | --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | `SessionId`、可选 `RequestId`、`MaxResults`、可选 `NextToken` | 完成鉴权/签名并调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，转发 JSON-RPC 响应。 |
| `POST /api/dataworks/get-agent-session-artifact-meta` | `SessionId`、`ArtifactPath` | 完成鉴权/签名并调用 [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta)，转发 JSON-RPC 响应。 |

端点和 BFF 参数名保持不变。`data.ts` 遍历全部分页并返回 descriptor，Get 返回 raw
string；404 为 not-found，408/425/429/5xx/网络错误为 retryable，鉴权、永久 4xx、
非法 envelope/content 为 fatal。AccessKey、Caller-Context、cookie 和签名必须留在
后端/宿主；`AbortSignal` 原样传递给原生 fetch，不能用
`waitForLegacySandboxAbortable` 二次包裹；代理和浏览器分别执行响应大小限制。

```sh
pnpm --filter @datafe-open/markdown-chart-example-vue-chatbi-openapi dev
```

legacy adapter 与临时 sandbox renderer 仍是可删除的迁移层；canonical JSON 图表和
普通 Vue/markdown-it 示例不依赖它们。
