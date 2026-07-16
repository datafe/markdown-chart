# Vue + markdown-it example

This runnable app renders both integration styles:

- `SimpleExample.vue` only imports `MarkdownChart`; the adapter owns markdown-it
  and creates the ECharts registry.
- `AdvancedExample.vue` passes a host-created markdown-it instance, plugin, and
  renderer registry to `MarkdownChart`.

Run the complete Vite example from the repository root:

```sh
pnpm --filter @datafe/markdown-chart-example-vue build
pnpm --filter @datafe/markdown-chart-example-vue dev
```
