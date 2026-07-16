# @datafe/markdown-chart-markdown-it

A markdown-it fence plugin that emits safe generated placeholders. Chart source
is returned through the render environment rather than copied into HTML.

Pass the live renderer registry to the plugin so shorthand aliases are routed
without adapter-specific language configuration:

```ts
const md = new MarkdownIt({ html: false })
  .use(markdownChartPlugin, { registry });
```

The canonical `markdown-chart` fence is always recognized. Advanced hosts may
supply an `isChartLanguage` predicate instead of, or in addition to, a
registry.
