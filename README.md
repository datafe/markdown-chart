# Markdown Chart

`markdown-chart` renders JSON chart specifications embedded in Markdown. Its
core is framework-neutral and independent of any chat product.

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
  "spec": {
    "data": {
      "kind": "inline",
      "dimensions": ["month", "sales"],
      "source": [["Jan", 100], ["Feb", 180]]
    },
    "option": {
      "xAxis": { "type": "category" },
      "yAxis": {},
      "series": [{ "type": "bar", "encode": { "x": "month", "y": "sales" } }]
    }
  }
}
```
````

There is only one protocol `version`, on the outer `markdown-chart` envelope.
Renderer specs do not repeat it.

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

## Core setup

```ts
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';

const registry = new ChartRendererRegistry();
registry.register(createEChartsRenderer({
  loadECharts: () => import('echarts'),
  resolveDataRef: async (ref, meta) => loadApplicationDataset(ref, meta.signal),
}));
```

Pass the same live registry to framework adapters. Renderer aliases registered
later, such as `vega-lite` or `plotly`, are then recognized without updating an
adapter language list:

```ts
const md = new MarkdownIt({ html: false }).use(markdownChartPlugin, { registry });
```

The package never fetches a data reference itself. Applications decide which
reference schemes are allowed and provide the resolver.

## React + react-markdown

```sh
pnpm add echarts react-markdown @datafe/markdown-chart \
  @datafe/markdown-chart-echarts @datafe/markdown-chart-react
```

````tsx
import ReactMarkdown from 'react-markdown';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChartProvider,
} from '@datafe/markdown-chart-react';

const registry = new ChartRendererRegistry().register(createEChartsRenderer({
  loadECharts: () => import('echarts'),
}));
const components = createMarkdownChartComponents({
  chartClassName: 'markdown-chart-block',
});
const source = `# Sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "spec": {
    "xAxis": { "type": "category", "data": ["A", "B"] },
    "yAxis": {},
    "series": [{ "type": "bar", "data": [10, 20] }]
  }
}
\`\`\``;

export function App() {
  return (
    <MarkdownChartProvider registry={registry}>
      <ReactMarkdown components={components}>{source}</ReactMarkdown>
    </MarkdownChartProvider>
  );
}
````

```css
.markdown-chart-block {
  min-height: 360px;
}
```

## Vue 3 + markdown-it

```sh
pnpm add echarts markdown-it @datafe/markdown-chart \
  @datafe/markdown-chart-echarts @datafe/markdown-chart-markdown-it \
  @datafe/markdown-chart-vue
```

`````vue
<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe/markdown-chart-vue';

const registry = new ChartRendererRegistry().register(createEChartsRenderer({
  loadECharts: () => import('echarts'),
}));
const md = new MarkdownIt({ html: false }).use(markdownChartPlugin, { registry });
const source = `# Sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "spec": {
    "xAxis": { "type": "category", "data": ["A", "B"] },
    "yAxis": {},
    "series": [{ "type": "bar", "data": [10, 20] }]
  }
}
\`\`\``;
</script>

<template>
  <MarkdownChart :source="source" :markdown-it="md" :registry="registry" />
</template>

<style>
.markdown-chart-placeholder {
  min-height: 360px;
}
</style>
`````

See [SPEC.md](./SPEC.md), [SECURITY.md](./SECURITY.md), and the Vue and React
examples under `examples/`.

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm build:examples
```

The root build validates both publishable packages and the React/Vue Vite
examples. Example workspaces are private and are never included in package
tarballs.

## License

MIT
