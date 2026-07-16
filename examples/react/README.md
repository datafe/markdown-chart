# React + react-markdown examples

The examples are separate runnable projects so their dependency manifests show
the actual integration cost:

- `simple/` only imports `MarkdownChart`; the adapter owns react-markdown and
  creates the ECharts registry.
- `advanced/` uses `MarkdownChartProvider` and
  `createMarkdownChartComponents` around the host's own `ReactMarkdown`, with a
  custom renderer registry.
- `chatbi-openapi/` shows a third-party application connecting ChatBI artifact
  data through its own same-origin DataWorks OpenAPI proxy.

Run either Vite example from the repository root:

```sh
pnpm --filter @datafe/markdown-chart-example-react-simple dev
pnpm --filter @datafe/markdown-chart-example-react-advanced dev
pnpm --filter @datafe/markdown-chart-example-react-chatbi-openapi dev
```
