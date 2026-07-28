# React + ChatBI OpenAPI 示例

本示例用于渲染 ChatBI 返回的流式 Markdown。宿主把既有的两个同源 OpenAPI
代理路由适配为 `LegacySandboxTransport`：

```tsx
const transport = useMemo(() => createChatBILegacySandboxTransport(), []);
const hostAdapter = useMemo(
  () => createLegacySandboxHostAdapter({ transport }),
  [transport],
);
const hostContext = useMemo(() => ({
  sessionId,
  requestId,
  phase: streaming ? 'live' : 'final',
  cacheScopeKey,
}), [sessionId, requestId, streaming, cacheScopeKey]);
const hostIdentity = hostAdapter.identity(hostContext);
const legacySandbox = useMemo(
  () => hostAdapter.bind(hostContext),
  [hostAdapter, hostIdentity],
);
if (!legacySandbox) throw new Error('sessionId and cacheScopeKey are required');
const echarts = useMemo(() => ({ legacySandbox }), [legacySandbox]);

<MarkdownChart source={markdown} streaming={streaming} echarts={echarts} />
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
  client/cache，并通过 `identity(context)` 让 React 在上下文变化时重新取得 binding；
  它不关心具体 OpenAPI 端点和响应格式。
- adapter 返回的 `legacySandbox` binding 才是 renderer 使用的接口。artifact 匹配、
  重试、request scope 到 session-only fallback 和成功缓存由 binding 背后的 shared
  client/resolver 统一完成。

transport 与 host adapter 在组件生命周期内保持稳定。
`cacheScopeKey` 是必填的非 secret 主体标识，推荐 `${tenantId}:${userId}`。不得使用
token、cookie、session secret 的原文或 hash，也不得回退为 `sessionId`。登录身份变化
时新的 binding/registry 会让既有 chart controller 取消旧请求；A → B → A 也不会复用
第一次 A 的 success cache。

本示例要求宿主在渲染流式正文前提供服务端下发的非空 `requestId`。不要传入前端生成的
UI fallback；`requestId` 会直接用于当前轮次的 artifact 查询，不再由示例扫描或改写
Markdown 等待后续补齐。

临时 query / sandbox-file fence 只通过
`createLegacySandboxHostAdapter` + `legacySandbox` 接入；renderer 和 React
`MarkdownChart` 不再提供 standalone legacy callback 配置。

## 浏览器到后端的契约

第三方后端继续只暴露两个同源路由，端点与参数没有变化：

| 浏览器端点 | 请求参数 | 后端职责 |
| --- | --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | `SessionId`、`RequestId`、`MaxResults`、可选 `NextToken` | 完成鉴权/签名并调用 [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts)，转发 JSON-RPC 响应。 |
| `POST /api/dataworks/get-agent-session-artifact-meta` | `SessionId`、`ArtifactPath` | 完成鉴权/签名并调用 [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta)，转发 JSON-RPC 响应。 |

`data.ts` 只遍历 List 分页、映射 descriptor、读取 raw `ArtifactContent`，并通过
`createLegacySandboxErrorClassifier` 扩展 host-owned HTTP / 网络 / envelope 错误。它不
复制 matching、retry、fallback 或 cache。AccessKey、
Caller-Context、cookie 和签名逻辑必须留在后端/宿主；代理应先鉴权并限制响应大小，
浏览器的 8 MiB 上限是第二道防线。`AbortSignal` 会原样传递给两个原生 fetch；不要用
`waitForLegacySandboxAbortable` 再包裹原生 fetch。

提供上述路由后运行：

```sh
pnpm --filter @datafe-open/markdown-chart-example-react-chatbi-openapi dev
```
