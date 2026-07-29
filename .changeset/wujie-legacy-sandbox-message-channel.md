---
'@datafe-open/markdown-chart-echarts': patch
---

Use a dedicated transferable `MessagePort` for legacy iframe sandbox replies so
rendering works when micro-frontends separate the JavaScript Window from the DOM
parent Window.
