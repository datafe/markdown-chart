# Vue + markdown-it + ChatBI OpenAPI 示例

本示例保留宿主的 markdown-it 处理链路，同时把既有两个同源 OpenAPI 代理路由
适配为 `LegacySandboxTransport`。`ChatBIChartMessage.vue` 与测试共用
`useChatBIChartMessageLifecycle`：

```ts
const transport = createChatBILegacySandboxTransport();
const hostAdapter = createLegacySandboxHostAdapter({ transport });
const { chartContext } = useChatBIChartMessageLifecycle({
  sessionId: () => props.sessionId,
  requestId: () => props.requestId,
  streaming: () => props.streaming,
  cacheScopeKey: () => props.cacheScopeKey,
}, hostAdapter);
```

### Transport 与 host adapter

两者分别负责网络契约和宿主生命周期，调用链如下：

```text
MarkdownChart → ECharts renderer → legacySandbox binding
              → shared resolver → transport → ChatBI OpenAPI
```

- `createChatBILegacySandboxTransport` 是宿主实现的网络层。它把公共 client 的
  `listFiles` / `readFile` 请求转换为 ChatBI OpenAPI 调用，处理分页、响应映射、大小
  限制和错误分类；它不知道 Markdown、artifact 匹配、重试、fallback 或缓存策略。
- `createLegacySandboxHostAdapter` 是公共包提供的生命周期层。它把 transport 绑定到
  当前 `cacheScopeKey`、`sessionId`、`requestId` 和 `phase`，按认证主体隔离
  client/cache，并通过 `identity(context)` 让 Vue 在上下文变化时重新计算 binding；
  它不关心具体 OpenAPI 端点和响应格式。
- adapter 返回的 `legacySandbox` binding 才是 renderer 使用的接口。artifact 匹配、
  重试、request scope 到 session-only fallback 和成功缓存由 binding 背后的 shared
  client/resolver 统一完成。

模板把 `chartContext.markdownIt` 和 `chartContext.registry` 交给 `<MarkdownChart>`；
example 的 `data.ts` 只负责 OpenAPI transport。

本示例要求宿主在渲染流式正文前提供服务端下发的非空 `requestId`。不要传入前端生成的
UI fallback；`requestId` 会直接用于当前轮次的 artifact 查询，不再由示例扫描或改写
Markdown 等待后续补齐。

`cacheScopeKey` 是调用方显式传入的必填非 secret 主体标识，推荐
`${tenantId}:${userId}`。不得使用 token/cookie/session secret 的原文或 hash，也不得
回退为 `sessionId`。认证主体变化会创建新的 client/registry，让旧 chart controller
按既有 Abort 生命周期取消；A → B → A 的第三次 A 会重新 List/Get，不会复用第一次
A 的 success cache。

新接入应使用 `createLegacySandboxHostAdapter` +
`createEChartsRenderer({ legacySandbox })`。
renderer 和 Vue `<MarkdownChart>` 不再提供 standalone legacy callback 配置。

## 浏览器到后端的契约

| 浏览器端点 | 请求参数 | 后端职责 |
| --- | --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | `SessionId`、`RequestId`、`MaxResults`、可选 `NextToken` | 完成鉴权/签名并调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，转发 JSON-RPC 响应。 |
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
