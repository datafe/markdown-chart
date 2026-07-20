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

All migration code lives under `src/legacy`; its exported types and options are
marked `@deprecated`. Removing that directory and the thin renderer hook does
not change the canonical envelope, parser, or validation path. See the ChatBI
OpenAPI example for host-side List/Get proxy integration.
