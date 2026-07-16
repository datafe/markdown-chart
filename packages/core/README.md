# @datafe/markdown-chart

Framework-neutral renderer registry, canonical `markdown-chart` fence router,
strict JSON parser, and one-container chart lifecycle controller. Canonical
inline datasets receive a built-in Chart/Data switch and bounded data table.

Canonical envelopes keep `data` separate from renderer-owned `spec`.
`parseMarkdownChartEnvelope()` exposes validated inline or referenced data so a
host can inspect the same rows without loading the renderer.

`ChartRenderRequest.streaming` is block-level pending state. Markdown adapters
defer only an unterminated tail fence; completed blocks remain mounted while
the surrounding document continues streaming.
