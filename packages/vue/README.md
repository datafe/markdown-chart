# @datafe-open/markdown-chart-vue

Vue 3 `<MarkdownChart>` component, `useMarkdownChart` composable, and lower-level
placeholder mounting utility for markdown-it applications.

`<MarkdownChart :source="markdown" />` works without supplying a markdown-it
instance or renderer registry. The component creates safe defaults, registers
ECharts and KPI, and applies a 360px minimum chart height automatically; KPI
cards override it with their compact content height. Canonical
inline datasets and renderer-resolved referenced datasets automatically
include a Chart/Data switch.
The switch uses chart and table icons while retaining accessible labels.

Install the zero-config component with:

```sh
pnpm add echarts @datafe-open/markdown-chart-vue
```

`markdown-it` is included by this package. Applications importing it directly
for a custom parser should still declare `markdown-it` as their own dependency.

The component observes replacement `markdownIt` and `registry` props. The
composable accepts either plain instances or Vue refs for both values.

Set `:streaming="true"` while tokens are arriving. Closed fences render
immediately, and their existing DOM and chart controller are reused as later
Markdown is appended. Only the active unterminated tail fence waits. Pending and
asynchronously mounting charts show the package loading state; pass
`:loading-label="..."` to localize its text.
Pass `:labels="labels"` to localize the Chart/Data controls, accessibility
labels, empty/truncated data messages, and the `Chart unavailable` error
fallback. The same option is available on `useMarkdownChart()` and
`mountMarkdownChartBlocks()`.
Pass `:reference-actions="referenceActions"` to the component, or the same
option to `useMarkdownChart()` / `mountMarkdownChartBlocks()`, to expose
renderer reference controls. The host selects supported refs with `canOpen` and
handles clicks with `open`; the packages do not interpret or navigate refs.
Pass a stable `:kpi="kpiOptions"` object for referenced KPI data. Keep that
object, its resolver callbacks, and `referenceActions.canOpen` / `open` callbacks
stable across streaming renders so the automatic registry and completed chart
mounts can be reused.

New legacy ChatBI integrations should create one `createLegacySandboxClient`
per authenticated principal lifecycle, compute a binding from `{ sessionId,
requestId, phase, cacheScopeKey }`, and register ECharts with
`createEChartsRenderer({ legacySandbox })`. Keep the client stable and replace
only the binding/registry context. `cacheScopeKey` must be an explicit stable,
non-secret principal identity; never use a token/cookie value or hash.
`legacySandbox` is the only supported public renderer configuration for
temporary ChatBI query and sandbox-file fences; `<MarkdownChart>` exposes no
standalone legacy resolver props or callback context keys.

Chart placeholders must have a non-zero height so ECharts can measure its
container:

```css
.markdown-chart-placeholder {
  min-height: 360px;
}
```
