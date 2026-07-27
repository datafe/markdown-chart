---
"@datafe-open/markdown-chart": patch
"@datafe-open/markdown-chart-markdown-it": patch
"@datafe-open/markdown-chart-react": patch
"@datafe-open/markdown-chart-vue": patch
---

Show a built-in, localizable loading indicator while a chart fence is incomplete and while parsing, data materialization, or runtime mounting is still in progress.
Expose `findUnclosedMarkdownFence` so block-oriented streaming hosts can identify the active tail fence without hiding it or duplicating Markdown fence parsing.
