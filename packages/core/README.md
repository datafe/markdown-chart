# @datafe-open/markdown-chart

Framework-neutral renderer registry, canonical `markdown-chart` fence router,
strict JSON parser, and one-container chart lifecycle controller. Canonical
inline datasets and renderer-materialized referenced datasets receive a
built-in Chart/Data switch and bounded data table.
The switch uses accessible chart/table icons and Qwen Code WebShell-inspired
card styling. Hosts can override `--markdown-chart-background`,
`--markdown-chart-subtle-background`, `--markdown-chart-accent`, and
`--markdown-chart-accent-foreground`. The selected Chart/Data icon foreground
falls back to `--markdown-chart-background`, then `#ffffff`, so hosts can pair
a custom accent background with a contrasting foreground.
See [Third-party notices](./THIRD_PARTY_NOTICES.md) for source attribution and
license details.

Renderers may expose a title through `getTitle(parsed)`. The core trims that
value and creates a title element only when it is non-empty; it never supplies
a fallback title. The Chart/Data controls remain right-aligned when no title is
present, and the chart keeps 8px of vertical spacing from the toolbar.

Canonical envelopes keep default `data` and optional named `datasets` separate
from renderer-owned `spec`. `parseMarkdownChartEnvelope()` exposes validated
inline or referenced ChartData objects and passes both forms to the selected
renderer. The shared Chart/Data view inspects the default `data`; renderers own
the presentation of any selected named datasets.

`materializeChartData()` is the shared renderer-neutral ref boundary. Hosts
provide `ResolveChartDataRef` and optional validation; core forwards the opaque
ref and abort signal, validates the returned scalar rows and explicit limits,
and returns inline data. It does not select a transport, fetch, authorize, or
interpret any ref scheme.

Dynamic renderer parse contexts expose normalized `language` and the optional
original `rawLanguage` first token. Adapters should preserve `rawLanguage` when
a dynamic fence embeds a case-sensitive payload such as a file path.

`ChartRenderRequest.streaming` is block-level pending state. Markdown adapters
defer only an unterminated tail fence; completed blocks remain mounted while
the surrounding document continues streaming. `ChartController` renders a
visible loading state while a block is pending and while parsing,
materialization, or runtime mounting is in flight. Set
`ChartRenderRequest.loadingLabel` to localize the default text. Custom Markdown
adapters that render isolated blocks can use `findUnclosedMarkdownFence` to
identify the active tail fence without duplicating fence parsing.

Set `ChartRenderRequest.labels` to localize chart accessibility labels, the
Chart/Data controls, empty-data text, truncation notice, and adapter error
fallbacks. `MarkdownChartLabelOverrides` is partial; omitted entries retain
the exported `DEFAULT_MARKDOWN_CHART_LABELS`. Framework adapters expose the
same `labels` object.

`ChartRenderRequest.referenceActions` is a renderer-neutral host boundary for
clickable references. Core only forwards `{ rendererId, reference: { ref,
label } }`; it does not parse refs, authorize access, fetch content, navigate,
or create a panel. Hosts can hide unsupported references with `canOpen` and
handle accepted clicks with `open`.
