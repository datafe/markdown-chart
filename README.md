# Markdown Chart

English | [简体中文](./README.zh-CN.md)

`markdown-chart` provides portable chart blocks for streaming Markdown, with
inspectable data and pluggable renderers. Its core is framework-neutral and
independent of any chat product.

The project starts with an ECharts renderer and adapters for markdown-it, Vue 3,
and react-markdown. The registry-based core can accept future Plotly, Vega, or
other renderer packages without adding chart-specific switches to the core.

## Packages

| Package | Purpose |
| --- | --- |
| `@datafe/markdown-chart` | Renderer registry, canonical `markdown-chart` routing, and lifecycle controller |
| `@datafe/markdown-chart-echarts` | Strict JSON-only ECharts renderer |
| `@datafe/markdown-chart-markdown-it` | Safe placeholder plugin and environment side channel |
| `@datafe/markdown-chart-vue` | Vue 3 component and composable |
| `@datafe/markdown-chart-react` | react-markdown `code`/`pre` adapter |

## Canonical Markdown

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["month", "sales"],
    "source": [["Jan", 100], ["Feb", 180]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "month", "y": "sales" } }]
  }
}
```
````

There is only one protocol `version`, on the outer `markdown-chart` envelope.
`data` is renderer-neutral so hosts can expose the inline rows independently,
for example in a “View data” action. `spec` belongs to the selected renderer and
does not repeat the data or version.

Hosts can inspect canonical data without loading a chart runtime:

```sh
pnpm add @datafe/markdown-chart
```

```ts
import { parseMarkdownChartEnvelope } from '@datafe/markdown-chart';

// chartFenceBody is the JSON text inside one markdown-chart fence.
const { data } = parseMarkdownChartEnvelope(chartFenceBody);
if (data?.kind === 'inline') {
  showDataTable(data.dimensions, data.source);
}
```

Renderer-specific fences remain available as shorthand. The ECharts package
recognizes `echarts` and the migration alias `echarts-fulldata`:

````markdown
```echarts
{
  "xAxis": { "type": "category", "data": ["A", "B"] },
  "yAxis": {},
  "series": [{ "type": "bar", "data": [10, 20] }]
}
```
````

## React + react-markdown

With the canonical Markdown above stored in `source`:

```sh
pnpm add echarts @datafe/markdown-chart-react
```

```tsx
import { MarkdownChart } from '@datafe/markdown-chart-react';

export function App({ source }: { source: string }) {
  return <MarkdownChart source={source} />;
}
```

## Vue 3 + markdown-it

```sh
pnpm add echarts @datafe/markdown-chart-vue
```

```vue
<script setup lang="ts">
import { MarkdownChart } from '@datafe/markdown-chart-vue';

defineProps<{ source: string }>();
</script>

<template>
  <MarkdownChart :source="source" />
</template>
```

Both components register ECharts, load it on first chart mount, and apply a
360px minimum height automatically. Canonical inline data also enables a
built-in Chart/Data switch with a bounded, scrollable data table. The React
package includes `react-markdown`, and the Vue package includes `markdown-it`.
Pass a custom `registry`, parser, theme, or renderer options only when the
defaults are not sufficient.

## Advanced setup

Create and pass a registry only when adding renderers or resolving host data:

```ts
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';

const registry = new ChartRendererRegistry();
registry.register(createEChartsRenderer({
  resolveDataRef: async (ref, meta) => loadApplicationDataset(ref, meta.signal),
}));
```

Pass the same live registry to framework adapters. Renderer aliases registered
later, such as `vega-lite` or `plotly`, are then recognized without updating an
adapter language list. The package never fetches a data reference itself;
applications decide which reference schemes are allowed.

### Existing react-markdown applications

The provider and components API remains available when the host already owns
the surrounding Markdown renderer. Using the configured `registry` above, the
integration remains:

```tsx
import ReactMarkdown from 'react-markdown';
import {
  MarkdownChartProvider,
  createMarkdownChartComponents,
} from '@datafe/markdown-chart-react';

const chartComponents = createMarkdownChartComponents({
  chartStyle: { minHeight: 360 },
});

<MarkdownChartProvider registry={registry} streaming={isStreaming}>
  <ReactMarkdown components={chartComponents}>{source}</ReactMarkdown>
</MarkdownChartProvider>
```

The provider infers `source` from its direct `ReactMarkdown` child, so streaming
support does not add another required prop in this common advanced setup. In
simple mode, pass the same state through the component's `streaming` prop.

During streaming, closed chart fences render immediately and keep their mounted
chart instance as later text arrives. Only the active unterminated tail fence
waits for more input.

Because the application imports `react-markdown` directly in this mode,
declare it as an application dependency as well:

```sh
pnpm add echarts react-markdown @datafe/markdown-chart-react
```

See [SPEC.md](./SPEC.md), [SECURITY.md](./SECURITY.md), and the Vue and React
[examples](./examples/). Simple and advanced modes live in separate runnable
folders with independent dependency manifests.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm build:examples
```

The root build validates both publishable packages and all four React/Vue Vite
examples. Example workspaces are private and are never included in package
tarballs.

## License

MIT
