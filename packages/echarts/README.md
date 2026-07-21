# @datafe-open/markdown-chart-echarts

Strict JSON-only ECharts renderer for the canonical `markdown-chart` protocol.
The ECharts runtime and any referenced dataset resolver are supplied by the
host; the canonical path never fetches data or evaluates JavaScript.

`createEChartsRenderer()` loads the host-installed `echarts` peer dependency on
first mount. Pass `loadECharts` only when supplying a custom ECharts build.

By default the renderer applies safe presentation defaults adapted from the
[Qwen Code WebShell ECharts component](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.tsx):
light/dark palettes, typography, grid spacing, axes, tooltip, legend, and
bar/line/pie series details. The exact 12-color light/dark palettes and theme
colors for the shared chart design system are maintained in this public
renderer, so hosts share one runtime source of truth. Explicit values in the
validated ECharts option override these defaults.
Pass `defaultStyle: false` to disable only these presentation defaults:

```ts
createEChartsRenderer({ defaultStyle: false });
```

Validation, canonical data injection, and data-ref resolution still apply.
See the package [Third-party notices](./THIRD_PARTY_NOTICES.md) for
attribution and license details.

When the shared Chart/Data card is available, its title comes from the first
non-empty ECharts `option.title.text` value. If `title.text` is absent or blank,
the card omits the title instead of showing a fallback. The same rule is
applied after a temporary legacy chart has been materialized. When the card
displays that title, the renderer removes the matching main title from its
cloned render option so the title appears only once. Other title-array entries
are preserved, and a matching entry with `subtext` keeps the subtitle. Mounting
the renderer directly, or rendering without an inline-data card, leaves the
native ECharts title unchanged.

In a canonical `markdown-chart` envelope, renderer-neutral `data` is a sibling
of `spec`, and `spec` is the ECharts option directly. This lets hosts inspect
inline data without understanding ECharts.

The renderer is selected by `"renderer": "echarts"` in the canonical
`markdown-chart` envelope. A renderer spec never defines its own `version`;
protocol versioning belongs to `markdown-chart`.

The exact `echarts-fulldata` alias accepts the `dataworks-chart` compact JSON
envelope `{ version: 1, data, option }`. It normalizes to the same ECharts
parsed data and option as canonical `{ renderer: "echarts", data, spec }`, so
title, safe string formatter templates, data refs, and Chart/Data behavior are
shared. The compact envelope rejects unknown fields, requires stable ASCII
dimensions and equal-width array rows, and never evaluates JavaScript. The
singular `echart-fulldata` alias is intentionally not registered.

When `resolveDataRef` materializes a referenced dataset, the renderer injects
the validated rows into `option.dataset` and returns the same rows through the
core materialization flow for the Chart/Data view.

## Temporary legacy adapter

Hosts that need the temporary query and sandbox-file fences can share the file
discovery state machine while keeping authentication and HTTP details local:

```ts
import {
  createEChartsRenderer,
  createLegacySandboxClient,
  type LegacySandboxFile,
  type LegacySandboxTransport,
} from '@datafe-open/markdown-chart-echarts';

interface HostFile extends LegacySandboxFile {
  readonly downloadId: string;
}

const transport: LegacySandboxTransport<HostFile> = {
  async listFiles({ sessionId, requestId, signal }) {
    return listAuthorizedFiles({ sessionId, requestId, signal });
  },
  async readFile({ sessionId, file, signal }) {
    return downloadAuthorizedCsv({ sessionId, id: file.downloadId, signal });
  },
  classifyError(error, operation) {
    return classifyHostSandboxError(error, operation);
  },
};

const client = createLegacySandboxClient({ transport });
const legacySandbox = client.bind({
  sessionId,
  requestId,
  phase: isStreaming ? 'live' : 'final',
  cacheScopeKey: `${tenantId}:${userId}`,
});
const renderer = createEChartsRenderer({ legacySandbox });
```

`cacheScopeKey` is required and must be a stable, non-secret principal identity;
never use a bearer token, cookie, or their hashes. The binding owns the fixed
request-to-session retry schedule, unique CSV matching, a private 30-second / 64
entry success cache, and `shouldDefer(language)` for live fences that do not yet
have a request id. A final binding without a request id deliberately skips both
success-cache reads and writes. The transport owns authorization, response
mapping, file download, and classification into `not-found`, `retryable`, or
`fatal`, and must honor the supplied `AbortSignal`.

Direct binding failures use the exported `LegacySandboxError` codes. A renderer
configured with `legacySandbox` preserves those public failures. It is invalid
to combine the binding with any of the three deprecated resolver callbacks;
without a binding, all existing callback combinations and error wrapping remain
unchanged.

`resolveLegacyArtifactContent` is a deprecated migration hook for existing
ChatBI streams. The host callback only returns the raw CSV `ArtifactContent`;
this package applies byte/row/column/cell limits, parses it, sanitizes the
temporary source, and evaluates that source in a dedicated Worker owned by a
unique-origin bootstrap iframe with a deny-by-default CSP. The JSON-only result
then passes through the same ECharts option validation as canonical content.

`resolveLegacySandboxFileContent` is the matching deprecated hook for
`echarts-chatbi_sandbox_filepath_<filePath>`. The package preserves the
case-sensitive `filePath`; the host owns session/request lookup and returns raw
CSV. Both legacy paths share the same CSV, sandbox, limits, and option pipeline.

All migration code lives under `src/legacy`. The three existing resolver
callbacks and the legacy limits remain marked `@deprecated`. The new client,
binding, transport, descriptor, and error exports are also a temporary legacy
migration surface, but are not individually annotated `@deprecated` in this
release so ChatBI and ADA can first converge on one implementation. Do not use
them for canonical or compact charts.

Removal requires every host to stop producing and resolving the temporary
query and sandbox-file fences, published deprecation notice for at least one
release cycle, and zero known repository, external-consumer, and runtime usage.
The removal release will delete the renderer option/callbacks, root exports,
and `src/legacy` implementation together while retaining canonical parsing and
validation. See the ChatBI OpenAPI example for host-side List/Get proxy
integration during the migration.
