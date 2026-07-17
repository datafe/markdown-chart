# @datafe-open/markdown-chart-markdown-it

A markdown-it fence plugin that emits safe generated placeholders. Chart source
is returned through the render environment rather than copied into HTML.

Pass the live renderer registry to the plugin so explicitly registered aliases
and dynamic renderer languages are routed without adapter-specific language
configuration. A renderer identifier alone is not treated as a fence language:

```ts
const md = new MarkdownIt({ html: false })
  .use(markdownChartPlugin, { registry });
```

The canonical `markdown-chart` fence is always recognized. Advanced hosts may
supply an `isChartLanguage` predicate instead of, or in addition to, a
registry.

Streaming hosts can create the render environment with
`createMarkdownChartEnvironment({ streaming: true })`. Each collected
block then reports `complete`; closed blocks can mount immediately while an
unterminated tail block remains pending.
