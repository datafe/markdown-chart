# Markdown Chart

<p align="center">
  <strong>Safe, streaming-ready charts for Markdown.</strong><br />
  Turn strict JSON code fences into interactive charts, KPI cards, and data tables.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@datafe-open/markdown-chart"><img alt="npm version" src="https://img.shields.io/npm/v/@datafe-open/markdown-chart?color=4f46e5"></a>
  <a href="https://github.com/datafe/markdown-chart/actions/workflows/release.yml"><img alt="Release" src="https://github.com/datafe/markdown-chart/actions/workflows/release.yml/badge.svg"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/datafe/markdown-chart"></a>
</p>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./docs/images/markdown-chart-kpi.png" alt="Markdown Chart rendering a responsive multi-KPI group" width="960" />
</p>

`markdown-chart` is a small, framework-friendly toolkit for rendering charts
inside Markdown—including Markdown that is still streaming from an AI or data
application. It keeps data inspectable, chart specifications portable, and
renderer code outside your Markdown pipeline.

## Why Markdown Chart?

- **Built for streaming Markdown.** Completed chart fences render immediately
  and stay mounted while the rest of the document continues to arrive.
- **Inspectable by default.** Canonical data is separate from the renderer
  specification, enabling a built-in Chart/Data switch and bounded data table.
- **Safe for generated content.** Document input is strict JSON—never
  executable JavaScript—and is protected by schema, size, and option limits.
- **Works with your stack.** Use the ready-made React + react-markdown or Vue 3
  + markdown-it components, or integrate the framework-neutral core.
- **Charts, KPIs, and tables.** ECharts visualizations, responsive multi-KPI
  cards, and AG Grid Community data tables are included as independent renderers.
- **Extensible without lock-in.** Register another renderer, resolve
  application-owned data references, or handle reference clicks in the host.

## Quick start

### React + react-markdown

```sh
pnpm add echarts @datafe-open/markdown-chart-react
```

````tsx
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

const source = `## Monthly sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["month", "sales"],
    "source": [["Jan", 100], ["Feb", 180], ["Mar", 260]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "month", "y": "sales" } }]
  }
}
\`\`\``;

export function Report() {
  return <MarkdownChart source={source} />;
}
````

The component configures react-markdown plus the ECharts, KPI, and table renderers. If
your application already owns the Markdown parser or renderer registry, use the
[advanced React example](./examples/react/advanced/) instead.

### Vue 3 + markdown-it

```sh
pnpm add echarts @datafe-open/markdown-chart-vue
```

```vue
<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';

defineProps<{ source: string; streaming?: boolean }>();
</script>

<template>
  <MarkdownChart :source="source" :streaming="streaming" />
</template>
```

The Vue component configures markdown-it plus the same built-in renderers. See
the [simple and advanced examples](./examples/) for complete runnable apps.

## What you can render

### Interactive tables

Use `renderer: "table"` for data that needs direct exploration. The Community
edition of AG Grid supplies typed sorting and filters, quick search,
virtualization, pinned columns, and CSV export. Structured cell options add
change indicators, bars, progress, and inline SVG sparklines without requiring
AG Grid Enterprise.

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "table",
  "data": {
    "kind": "inline",
    "source": [
      { "region": "East", "sales": 1280000, "growth": 0.18, "apr": 31, "may": 36, "jun": 42 },
      { "region": "South", "sales": 960000, "growth": -0.04, "apr": 27, "may": 26, "jun": 25 }
    ]
  },
  "spec": {
    "title": "Regional sales",
    "columns": [
      { "field": "region", "title": "Region", "pinned": "left" },
      { "field": "sales", "title": "Sales", "type": "number", "format": { "style": "currency", "currency": "CNY", "notation": "compact" } },
      { "field": "growth", "title": "YoY", "type": "number", "format": { "style": "percent" }, "cell": { "kind": "change", "polarity": "higher-is-better" } },
      { "id": "trend", "title": "Three months", "cell": { "kind": "sparkline", "fields": ["apr", "may", "jun"], "scale": "column" } }
    ]
  }
}
```
````

The same table is loaded lazily in the Data pane for canonical tabular data.
If the interactive provider cannot load, the bounded core HTML view remains
available. Table rendering accepts at most 10,000 rows and 200,000 cells by
default; hosts can lower these limits.

### ECharts

Use `renderer: "echarts"` with renderer-neutral `data` and a strict JSON
ECharts `spec`. Explicit ECharts values win over the presentation defaults.
Inline data—and referenced data returned by your resolver—automatically gets a
Chart/Data switch.

Use `data.shape: "graph"` for canonical nodes/links rendered as Sankey or
relationship graphs, and `data.shape: "hierarchy"` for canonical children
rendered as tree, treemap, or sunburst. The renderer maps that one source into
ECharts while the shared card exposes Nodes/Links or flattened hierarchy data.
Structured series never duplicate facts in `series.data` or `series.links`.

### Multi-KPI cards

Use `renderer: "kpi"` for a responsive group of 1–12 metrics. KPI items can
bind values from shared or named datasets, format numbers with structured
`Intl.NumberFormat` options, display semantic status, draw line or area
sparklines, and expose optional host-owned references.

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [
      { "day": "2026-09-01", "conversion": 0.38, "revenue": 16800000 },
      { "day": "2026-09-02", "conversion": 0.42, "revenue": 18000000 }
    ]
  },
  "spec": {
    "timeField": "day",
    "items": [
      {
        "id": "conversion",
        "title": "Conversion",
        "value": { "field": "conversion", "format": { "style": "percent" } },
        "trend": { "type": "area", "compare": { "lag": 1, "mode": "absolute" } }
      },
      {
        "id": "revenue",
        "title": "Revenue",
        "value": {
          "field": "revenue",
          "format": { "style": "currency", "currency": "CNY", "notation": "compact" }
        }
      }
    ]
  }
}
```
````

## Streaming

Pass the outer document state while tokens are arriving:

```tsx
<MarkdownChart source={source} streaming={isStreaming} />
```

```vue
<MarkdownChart :source="source" :streaming="isStreaming" />
```

Closed fences render as soon as they are complete. Only the active,
unterminated tail fence waits for more input, and pending parsing, data
resolution, or runtime mounting shows a built-in loading state.

## Host-owned data and actions

Canonical data can be inline or an opaque reference such as
`dataset://forecast`. The library never chooses a transport or fetches that
reference itself: the host validates it and provides a resolver. KPI reference
controls follow the same boundary—the renderer forwards an opaque event, while
the host decides whether and how to open it.

This keeps application data access, authorization, navigation, and domain
protocols outside the public renderer.

The ECharts renderer defaults to at most 100,000 rows, 1,000,000 cells, and
1,200,000 JSON nodes. Legacy ChatBI CSV adapters additionally allow up to
64 MiB and 200 columns. These budgets target narrow-table trends resolved through
`data.kind: "ref"` or a host adapter; the core Markdown fence remains bounded
separately and is not intended to carry 100,000 inline rows. Hosts with tighter
resource budgets can lower any renderer limit through
`createEChartsRenderer({ limits })`.

Core separately bounds structured data to 2,000 nodes, 4,000 graph links, and
20 hierarchy levels by default. Configure these registry budgets with
`new ChartRendererRegistry({ dataLimits: { ... } })`; ECharts-specific table
row/cell limits retain their existing behavior.

## Packages

| Package | Purpose |
| --- | --- |
| [`@datafe-open/markdown-chart`](https://www.npmjs.com/package/@datafe-open/markdown-chart) | Framework-neutral registry, canonical parser, data view, and lifecycle controller |
| [`@datafe-open/markdown-chart-echarts`](https://www.npmjs.com/package/@datafe-open/markdown-chart-echarts) | Strict JSON ECharts renderer |
| [`@datafe-open/markdown-chart-kpi`](https://www.npmjs.com/package/@datafe-open/markdown-chart-kpi) | Responsive multi-KPI renderer |
| [`@datafe-open/markdown-chart-table`](https://www.npmjs.com/package/@datafe-open/markdown-chart-table) | Interactive AG Grid Community table renderer and Data-view provider |
| [`@datafe-open/markdown-chart-markdown-it`](https://www.npmjs.com/package/@datafe-open/markdown-chart-markdown-it) | markdown-it placeholder plugin and environment channel |
| [`@datafe-open/markdown-chart-react`](https://www.npmjs.com/package/@datafe-open/markdown-chart-react) | React + react-markdown component and adapter |
| [`@datafe-open/markdown-chart-vue`](https://www.npmjs.com/package/@datafe-open/markdown-chart-vue) | Vue 3 + markdown-it component and composable |

## Documentation

- [Protocol specification](./SPEC.md)
- [Security model and supported ECharts profile](./SECURITY.md)
- [Runnable examples](./examples/)
- [React package guide](./packages/react/README.md)
- [Vue package guide](./packages/vue/README.md)
- [Release process](./RELEASING.md)

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm check:pack
```

Issues and pull requests are welcome. Published-package changes use Changesets;
the root build also validates all React and Vue examples.

## License

MIT. Portions are adapted from Qwen Code under Apache-2.0; see
[Third-party notices](./THIRD_PARTY_NOTICES.md).
