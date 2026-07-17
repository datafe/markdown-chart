# @datafe-open/markdown-chart-echarts

Strict JSON-only ECharts renderer for the canonical `markdown-chart` protocol.
The ECharts runtime and any referenced dataset resolver are supplied by the
host; the canonical path never fetches data or evaluates JavaScript.

`createEChartsRenderer()` loads the host-installed `echarts` peer dependency on
first mount. Pass `loadECharts` only when supplying a custom ECharts build.

By default the renderer applies safe presentation defaults adapted from the
[Qwen Code WebShell ECharts component](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.tsx):
light/dark palettes, typography, grid spacing, axes, tooltip, legend, and
bar/line/pie series details. Explicit values in the validated ECharts option
override these defaults. Pass `defaultStyle: false` to disable only these
presentation defaults:

```ts
createEChartsRenderer({ defaultStyle: false });
```

Validation, canonical data injection, and data-ref resolution still apply.
See the package [Third-party notices](./THIRD_PARTY_NOTICES.md) for
attribution and license details.

In a canonical `markdown-chart` envelope, renderer-neutral `data` is a sibling
of `spec`, and `spec` is the ECharts option directly. This lets hosts inspect
inline data without understanding ECharts.

The renderer is selected by `"renderer": "echarts"` in the canonical
`markdown-chart` envelope. A renderer spec never defines its own `version`;
protocol versioning belongs to `markdown-chart`.

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

All migration code lives under `src/legacy`; its exported types and options are
marked `@deprecated`. Removing that directory and the thin renderer hook does
not change the canonical envelope, parser, or validation path. See the ChatBI
OpenAPI example for host-side List/Get proxy integration.
