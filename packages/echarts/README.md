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
  createLegacySandboxErrorClassifier,
  createLegacySandboxHostAdapter,
  waitForLegacySandboxAbortable,
  type LegacySandboxFile,
  type LegacySandboxTransport,
} from '@datafe-open/markdown-chart-echarts';

interface HostFile extends LegacySandboxFile {
  readonly downloadId: string;
}

const classifyError = createLegacySandboxErrorClassifier({
  getStatus(error) {
    return isHostHttpError(error) ? error.statusCode : undefined;
  },
});

const transport: LegacySandboxTransport<HostFile> = {
  async listFiles({ sessionId, requestId, signal }) {
    const request = listAuthorizedFiles({ sessionId, requestId });
    return waitForLegacySandboxAbortable(request, signal);
  },
  async readFile({ sessionId, file, signal }) {
    const request = downloadAuthorizedCsv({ sessionId, id: file.downloadId });
    return waitForLegacySandboxAbortable(request, signal);
  },
  classifyError,
};

const adapter = createLegacySandboxHostAdapter({ transport });
const context = {
  sessionId,
  requestId,
  phase: turnPhase,
  cacheScopeKey: `${tenantId}:${userId}`,
} as const;
const legacySandbox = adapter.bind(context);
if (!legacySandbox) throw new Error('Legacy sandbox context is incomplete');
const renderer = createEChartsRenderer({ legacySandbox });
const rendererIdentity = adapter.identity(context);
```

`cacheScopeKey` is required and must be a stable, non-secret principal identity;
never use a bearer token, cookie, or their hashes. The binding owns the fixed
request-to-session retry schedule, unique CSV matching, a private 30-second / 64
entry success cache, and `shouldDefer(language)` for live fences that do not yet
have a request id. A final binding without a request id deliberately skips both
success-cache reads and writes. The transport owns authorization, response
mapping, file download, and classification into `not-found`, `retryable`, or
`fatal`, and must honor the supplied `AbortSignal`.

The optional host helpers keep the remaining host-neutral glue in this package:
`waitForLegacySandboxAbortable` bridges an abortable Promise-like request to an
`AbortSignal`, `createLegacySandboxErrorClassifier` handles structural HTTP and
network failures without inspecting error messages, and
`createLegacySandboxHostAdapter` normalizes context and privately owns the
active client/cache generation. A host still owns its authenticated API calls,
response and file-descriptor mapping, download URL handling, principal source,
and any host-specific status extensions. Use `adapter.identity(context)` as the
host component/controller identity so a principal or turn change replaces and
disposes the old controller. Create a new adapter instance when an isolated
client/cache lifetime is needed; the public adapter intentionally has no
`reset()` method. Direct `createLegacySandboxClient({ transport })` usage remains
supported for existing consumers. `turnPhase` must come from the host's actual
assistant-turn lifecycle; do not infer it from a renderer placeholder or fence
state.

Direct binding failures use the exported `LegacySandboxError` codes. A renderer
configured with `legacySandbox` preserves those public failures. `legacySandbox`
is the only public renderer configuration for temporary ChatBI query and
sandbox-file fences. Its `resolveLegacyArtifactContent` and
`resolveLegacySandboxFileContent` methods are internal binding execution
contracts created by the shared client, not standalone renderer options or
framework component props. The matching function types remain exported so
custom `LegacySandboxBinding` implementations can satisfy that contract.

The binding returns authorized raw CSV content to the renderer. This package
applies byte/row/column/cell limits, preserves case-sensitive sandbox paths,
parses the CSV, sanitizes the temporary source, and evaluates that source in a
dedicated Worker owned by a unique-origin bootstrap iframe with a deny-by-default
CSP. The JSON-only result then passes through the same ECharts option validation
as canonical content.

All migration code lives under `src/legacy`. The binding method request/function
types and legacy limits remain marked `@deprecated`; they are retained only as
the internal execution signatures of `LegacySandboxBinding`. The client,
binding, transport, descriptor, and error exports are also a temporary legacy
migration surface, but are not individually annotated `@deprecated` in this
release so ChatBI and ADA can converge on one implementation. Do not use them
for canonical or compact charts.

Removal requires every host to stop producing and resolving the temporary
query and sandbox-file fences, published deprecation notice for at least one
release cycle, and zero known repository, external-consumer, and runtime usage.
The removal release will delete the `legacySandbox` renderer option, temporary
type exports, and `src/legacy` implementation together while retaining canonical
parsing and validation. See the ChatBI OpenAPI example for host-side List/Get
proxy integration during the migration.
