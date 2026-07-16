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

## React + react-markdown

With the canonical Markdown above stored in `source`:

```sh
pnpm add echarts react-markdown @datafe/markdown-chart-react
```

```tsx
import { MarkdownChart } from '@datafe/markdown-chart-react';

export function App({ source }: { source: string }) {
  return <MarkdownChart source={source} />;
}
```

## Vue 3 + markdown-it

```sh
pnpm add echarts markdown-it @datafe/markdown-chart-vue
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
360px minimum height automatically. Pass a custom `registry`, parser, theme, or
renderer options only when the defaults are not sufficient.

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
