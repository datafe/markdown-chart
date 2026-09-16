---
'@datafe-open/markdown-chart-echarts': patch
---

Raise the default ECharts renderer budget to 100,000 rows, 500,000 cells, and
700,000 JSON nodes for narrow-table trend data. Hosts can still provide lower
limits, while Markdown fence size limits and legacy artifact byte, column, and
timeout limits remain unchanged.
