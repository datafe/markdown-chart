---
'@datafe-open/markdown-chart-echarts': patch
---

Apply the ECharts renderer node budget while validating options produced by the
temporary legacy sandbox, so supported 100,000-row trend charts are not
rejected by the core JSON validator's lower default.
