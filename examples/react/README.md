# React + react-markdown example

This runnable app renders both integration styles:

- `SimpleExample.tsx` only imports `MarkdownChart`; the adapter owns
  react-markdown and creates the ECharts registry.
- `AdvancedExample.tsx` uses `MarkdownChartProvider` and
  `createMarkdownChartComponents` around the host's own `ReactMarkdown`, with a
  custom renderer registry.

Run the complete Vite example from the repository root:

```sh
pnpm --filter @datafe/markdown-chart-example-react build
pnpm --filter @datafe/markdown-chart-example-react dev
```
