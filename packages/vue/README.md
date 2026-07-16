# @datafe/markdown-chart-vue

Vue 3 `<MarkdownChart>` component, `useMarkdownChart` composable, and lower-level
placeholder mounting utility for markdown-it applications.

The component observes replacement `markdownIt` and `registry` props. The
composable accepts either plain instances or Vue refs for both values.

Chart placeholders must have a non-zero height so ECharts can measure its
container:

```css
.markdown-chart-placeholder {
  min-height: 360px;
}
```
