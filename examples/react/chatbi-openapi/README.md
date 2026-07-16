# React + ChatBI OpenAPI example

This example renders the streaming Markdown returned by ChatBI. A third-party
application supplies one callback that returns the raw CSV `ArtifactContent`:

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

The component owns bounded CSV parsing, temporary source sanitization,
dedicated-Worker conversion inside a unique-origin bootstrap iframe, JSON
validation, and inline data materialization. The host does not parse CSV and
does not execute chart source.

The memoized resolver in this example changes identity when `sessionId` or
`requestId` changes, so the component safely invalidates the completed chart.
Applications that recreate equivalent callbacks on unrelated rerenders can
pass a stable deprecated `legacyArtifactContextKey`; when omitted, callback
identity is the cache boundary.

Pass the current `requestId` whenever it is available. It limits artifact
lookup to the current ChatBI request. Without it, the list operation searches
the whole session, so an old artifact with the same name can be ambiguous.

## Browser-to-backend contracts

The third-party backend exposes only two same-origin routes:

| Browser endpoint | Backend responsibility |
| --- | --- |
| `POST /api/dataworks/list-agent-session-artifacts` | Sign and call [`ListAgentSessionArtifacts`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-listagentsessionartifacts). Forward the JSON-RPC response. |
| `POST /api/dataworks/get-agent-session-artifact-meta` | Sign and call [`GetAgentSessionArtifactMeta`](https://help.aliyun.com/zh/dataworks/developer-reference/api-dataworks-public-2024-05-18-getagentsessionartifactmeta). Forward the JSON-RPC response. |

The helper follows List pagination, requires exactly one matching artifact,
calls Get with `SessionId + ArtifactPath`, and returns `ArtifactContent`
unchanged. AccessKey credentials and signing logic must remain on the backend.
The proxy should apply authorization and a response-size limit before buffering
the content; the component's browser limits are a second line of defense.

Run the example after providing both routes:

```sh
pnpm --filter @datafe/markdown-chart-example-react-chatbi-openapi dev
```
