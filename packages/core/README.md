# @datafe/markdown-chart

Framework-neutral renderer registry, canonical `markdown-chart` fence router,
strict JSON parser, and one-container chart lifecycle controller.

Canonical envelopes keep `data` separate from renderer-owned `spec`.
`parseMarkdownChartEnvelope()` exposes validated inline or referenced data so a
host can implement actions such as “View data” without loading the renderer.
