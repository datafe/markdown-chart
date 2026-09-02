# @datafe-open/markdown-chart-react

Zero-config `<MarkdownChart source={markdown} />`, provider, chart block, and
`createMarkdownChartComponents()` adapter for react-markdown. The zero-config
component registers ECharts and KPI automatically and gives chart blocks a
360px minimum height; KPI cards override it with their compact content height.
Canonical inline datasets and renderer-resolved referenced datasets
automatically include a Chart/Data icon switch.

Install the zero-config component with:

```sh
pnpm add echarts @datafe-open/markdown-chart-react
```

`react-markdown` is included by this package. Applications using the lower-level
provider and importing `react-markdown` directly should still declare
`react-markdown` as their own dependency.

The `pre` adapter reads the live registry from `MarkdownChartProvider`; newly
registered renderer aliases work without rebuilding a language list. When
using this lower-level adapter directly, give the chart class a non-zero height
so the chart runtime can measure its container.

Set `streaming` on `MarkdownChart` or `MarkdownChartProvider` while tokens are
arriving. Closed chart fences render immediately; only the active unterminated
tail fence waits. The provider automatically infers the Markdown source from a
direct `ReactMarkdown` child, so the usual advanced integration needs no extra
source prop. Pending and asynchronously mounting charts show the package loading
state; pass `loadingLabel` to `MarkdownChart`, `MarkdownChartProvider`, or an
individual `MarkdownChartBlock` to localize its text.
Pass `labels` to the same APIs to localize the Chart/Data controls,
accessibility labels, empty/truncated data messages, and the
`Chart unavailable` error fallback.
Pass `referenceActions` to `MarkdownChart` or `MarkdownChartProvider` to expose
renderer reference controls. The host selects supported refs with `canOpen` and
handles clicks with `open`; the packages do not interpret or navigate refs.
KPI referenced data uses the independent `kpi` renderer option:

```tsx
<MarkdownChart
  source={source}
  kpi={{ validateDataRef, resolveDataRef }}
/>
```

Keep the `kpi` options and resolver callbacks stable across streaming renders
so the automatic registry and completed chart mounts can be reused.

New legacy ChatBI integrations should create one `createLegacySandboxClient`
per authenticated principal lifecycle, bind `{ sessionId, requestId, phase,
cacheScopeKey }`, and pass the binding as `echarts={{ legacySandbox }}`. Keep
the client stable across ordinary renders and rebind when context changes.
`cacheScopeKey` must be an explicit stable, non-secret principal identity; do
not use a token/cookie value or hash, and rebuild the client on login changes.
`echarts.legacySandbox` is the only supported public configuration for temporary
ChatBI query and sandbox-file fences; the zero-config component exposes no
standalone legacy resolver props or callback context keys.
