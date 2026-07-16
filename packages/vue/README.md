# @datafe/markdown-chart-vue

Vue 3 `<MarkdownChart>` component, `useMarkdownChart` composable, and lower-level
placeholder mounting utility for markdown-it applications.

`<MarkdownChart :source="markdown" />` works without supplying a markdown-it
instance or renderer registry. The component creates safe defaults, registers
ECharts, and applies a 360px minimum chart height automatically.

Install the zero-config component with:

```sh
pnpm add echarts @datafe/markdown-chart-vue
```

`markdown-it` is included by this package. Applications importing it directly
for a custom parser should still declare `markdown-it` as their own dependency.

The component observes replacement `markdownIt` and `registry` props. The
composable accepts either plain instances or Vue refs for both values.

Chart placeholders must have a non-zero height so ECharts can measure its
container:

```css
.markdown-chart-placeholder {
  min-height: 360px;
}
```
