# Markdown Chart

English | [简体中文](./README.zh-CN.md)

> [!IMPORTANT]
> **Pre-release:** the `@datafe-open/markdown-chart*` packages are not published to
> npm yet. The install commands below describe the planned public interface.
> Until the first release, clone this repository and run the local examples.
> Maintainers should follow [RELEASING.md](./RELEASING.md).

`markdown-chart` provides portable chart blocks for streaming Markdown, with
inspectable data and pluggable renderers. Its core is framework-neutral and
independent of any chat product.

The project starts with an ECharts renderer and adapters for markdown-it, Vue 3,
and react-markdown. The registry-based core can accept future Plotly, Vega, or
other renderer packages without adding chart-specific switches to the core.

## Packages

| Package | Purpose |
| --- | --- |
| `@datafe-open/markdown-chart` | Renderer registry, canonical `markdown-chart` routing, and lifecycle controller |
| `@datafe-open/markdown-chart-echarts` | Strict JSON-only ECharts renderer |
| `@datafe-open/markdown-chart-markdown-it` | Safe placeholder plugin and environment side channel |
| `@datafe-open/markdown-chart-vue` | Vue 3 component and composable |
| `@datafe-open/markdown-chart-react` | react-markdown `code`/`pre` adapter |

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
pnpm add @datafe-open/markdown-chart
```

```ts
import { parseMarkdownChartEnvelope } from '@datafe-open/markdown-chart';

// chartFenceBody is the JSON text inside one markdown-chart fence.
const { data } = parseMarkdownChartEnvelope(chartFenceBody);
if (data?.kind === 'inline') {
  showDataTable(data.dimensions, data.source);
}
```

## React + react-markdown

With the canonical Markdown above stored in `source`:

```sh
pnpm add echarts @datafe-open/markdown-chart-react
```

```tsx
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

export function App({ source }: { source: string }) {
  return <MarkdownChart source={source} />;
}
```

## Vue 3 + markdown-it

```sh
pnpm add echarts @datafe-open/markdown-chart-vue
```

```vue
<script setup lang="ts">
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';

defineProps<{ source: string }>();
</script>

<template>
  <MarkdownChart :source="source" />
</template>
```

Both components register ECharts, load it on first chart mount, and apply a
360px minimum height automatically. Canonical inline data and referenced data
returned by `resolveDataRef` also enable a built-in icon-based Chart/Data switch
with a bounded, scrollable data table.
The card, toolbar, icons, table, and default ECharts palette/axes/tooltip/series
styling are adapted from the
[Qwen Code WebShell implementation](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.tsx),
while explicit ECharts option values still win. The React package includes
`react-markdown`, and the Vue package includes `markdown-it`. Pass a custom
`registry`, parser, theme, or renderer options only when the defaults are not
sufficient. See [Third-party notices](./THIRD_PARTY_NOTICES.md) for attribution.

Card colors can be aligned with the host through `--markdown-chart-background`,
`--markdown-chart-subtle-background`, and `--markdown-chart-accent`. Advanced
registries can set `createEChartsRenderer({ defaultStyle: false })` to disable
the presentation defaults. Validation, canonical data injection, and data-ref
resolution still apply.

## Streaming

Pass the outer document streaming state to the framework component:

```tsx
<MarkdownChart source={source} streaming={isStreaming} />
```

```vue
<MarkdownChart :source="source" :streaming="isStreaming" />
```

Closed chart fences render immediately and keep their mounted chart instance as
later text arrives. Only the active unterminated tail fence waits for more
input. Advanced React applications pass the same state to
`MarkdownChartProvider`; advanced Vue applications pass it to `MarkdownChart`.

## Advanced setup

Create and pass a registry only when adding renderers or resolving host data:

```ts
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer } from '@datafe-open/markdown-chart-echarts';

const registry = new ChartRendererRegistry();
registry.register(createEChartsRenderer({
  resolveDataRef: async (ref, meta) => loadApplicationDataset(ref, meta.signal),
}));
```

The resolver returns `{ dimensions?, source }`. If it omits `dimensions`, the
dimensions declared on the ref are retained. ECharts uses the materialized rows
for both `option.dataset` and the shared Chart/Data view, so referenced datasets
can be inspected without duplicating them inline.

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
} from '@datafe-open/markdown-chart-react';

const chartComponents = createMarkdownChartComponents({
  chartStyle: { minHeight: 360 },
});

<MarkdownChartProvider registry={registry} streaming={isStreaming}>
  <ReactMarkdown components={chartComponents}>{source}</ReactMarkdown>
</MarkdownChartProvider>
```

The provider infers `source` from its direct `ReactMarkdown` child, so streaming
support does not add another required prop in this common advanced setup.

Because the application imports `react-markdown` directly in this mode,
declare every directly imported package as an application dependency:

```sh
pnpm add echarts react-markdown \
  @datafe-open/markdown-chart \
  @datafe-open/markdown-chart-echarts \
  @datafe-open/markdown-chart-react
```

### Existing Vue + markdown-it applications

Vue applications can keep their existing markdown-it instance and pass the
same registry to both the plugin and component:

```vue
<script setup lang="ts">
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer } from '@datafe-open/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe-open/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import MarkdownIt from 'markdown-it';

defineProps<{ source: string; isStreaming: boolean }>();

const registry = new ChartRendererRegistry().register(createEChartsRenderer());
const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
  registry,
});
</script>

<template>
  <MarkdownChart
    :source="source"
    :streaming="isStreaming"
    :markdown-it="markdownIt"
    :registry="registry"
  />
</template>
```

Declare the packages imported by this advanced setup directly:

```sh
pnpm add echarts markdown-it \
  @datafe-open/markdown-chart \
  @datafe-open/markdown-chart-echarts \
  @datafe-open/markdown-chart-markdown-it \
  @datafe-open/markdown-chart-vue
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
pnpm check:pack
```

The root build validates both publishable packages and all React/Vue Vite
examples. Example workspaces are private and are never included in package
tarballs. Published-package changes use Changesets; see
[RELEASING.md](./RELEASING.md) for bootstrap and automated release steps.

## License

MIT. Portions are adapted from Qwen Code under Apache-2.0; see
[Third-party notices](./THIRD_PARTY_NOTICES.md).
