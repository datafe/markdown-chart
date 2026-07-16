# @datafe/markdown-chart-echarts

Strict JSON-only ECharts renderer. The ECharts runtime and any referenced
dataset resolver are supplied by the host; this package never fetches data or
evaluates chart JavaScript.

`createEChartsRenderer()` loads the host-installed `echarts` peer dependency on
first mount. Pass `loadECharts` only when supplying a custom ECharts build.

In a canonical `markdown-chart` envelope, renderer-neutral `data` is a sibling
of `spec`, and `spec` is the ECharts option directly. This lets hosts inspect
inline data without understanding ECharts.

The `echarts` and `echarts-fulldata` shorthand fences also accept a direct
option or the renderer-specific `{ data, option }` body. A renderer spec never
defines its own `version`; protocol versioning belongs to `markdown-chart`.
