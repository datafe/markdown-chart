# Vue + markdown-it examples

The examples are separate runnable projects so their dependency manifests show
the actual integration cost:

- `simple/` only imports `MarkdownChart`; the adapter owns markdown-it and
  creates the ECharts registry.
- `advanced/` passes a host-created markdown-it instance, plugin, and renderer
  registry to `MarkdownChart`.

Run either Vite example from the repository root:

```sh
pnpm --filter @datafe/markdown-chart-example-vue-simple dev
pnpm --filter @datafe/markdown-chart-example-vue-advanced dev
```
