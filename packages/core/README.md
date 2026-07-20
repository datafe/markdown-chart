# @datafe-open/markdown-chart

Framework-neutral renderer registry, canonical `markdown-chart` fence router,
strict JSON parser, and one-container chart lifecycle controller. Canonical
inline datasets and renderer-materialized referenced datasets receive a
built-in Chart/Data switch and bounded data table.
The switch uses accessible chart/table icons and Qwen Code WebShell-inspired
card styling. Hosts can override `--markdown-chart-background`,
`--markdown-chart-subtle-background`, and `--markdown-chart-accent`.
See [Third-party notices](./THIRD_PARTY_NOTICES.md) for source attribution and
license details.

Renderers may expose a title through `getTitle(parsed)`. The core trims that
value and creates a title element only when it is non-empty; it never supplies
a fallback title. The Chart/Data controls remain right-aligned when no title is
present, and the chart keeps 8px of vertical spacing from the toolbar.

Canonical envelopes keep `data` separate from renderer-owned `spec`.
`parseMarkdownChartEnvelope()` exposes validated inline or referenced data so a
host can inspect the same rows without loading the renderer.

Dynamic renderer parse contexts expose normalized `language` and the optional
original `rawLanguage` first token. Adapters should preserve `rawLanguage` when
a dynamic fence embeds a case-sensitive payload such as a file path.

`ChartRenderRequest.streaming` is block-level pending state. Markdown adapters
defer only an unterminated tail fence; completed blocks remain mounted while
the surrounding document continues streaming.
