# @datafe/markdown-chart-echarts

Strict JSON-only ECharts renderer. The ECharts runtime and any referenced
dataset resolver are supplied by the host; this package never fetches data or
evaluates chart JavaScript.

`createEChartsRenderer()` loads the host-installed `echarts` peer dependency on
first mount. Pass `loadECharts` only when supplying a custom ECharts build.

An ECharts spec may be a direct option object or a `{ data, option }` object.
It does not define its own `version`; protocol versioning belongs to the outer
`markdown-chart` envelope.
