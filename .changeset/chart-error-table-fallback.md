---
"@datafe-open/markdown-chart": patch
"@datafe-open/markdown-chart-echarts": patch
"@datafe-open/markdown-chart-kpi": patch
"@datafe-open/markdown-chart-markdown-it": patch
"@datafe-open/markdown-chart-react": patch
"@datafe-open/markdown-chart-vue": patch
---

Degrade to the data table when chart mounting fails but inline data is
already readable, instead of replacing the entire placeholder with "chart
unavailable". Hosts may now observe the failure through a new optional
`ChartRenderRequest.onError` callback while users keep access to the
data table. Failures that happen before any inline data exists (parse,
prepare, or renderer-reported data contract violations such as KPI's
schema/limit checks) keep the original placeholder behaviour.
