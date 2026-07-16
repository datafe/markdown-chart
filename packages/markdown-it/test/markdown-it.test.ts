import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import {
  getMarkdownChartBlocks,
  markdownChartPlugin,
  type MarkdownChartEnvironment,
} from '../src/index';

describe('markdownChartPlugin', () => {
  it('keeps chart JSON out of generated HTML and exposes it through env', () => {
    const md = new MarkdownIt({ html: false }).use(markdownChartPlugin);
    const env: MarkdownChartEnvironment = {};
    const source = '```markdown-chart\n{"version":1,"renderer":"echarts","data":{"kind":"inline","source":[]},"spec":{}}\n```';
    const html = md.render(source, env);

    expect(html).toContain('data-markdown-chart-id="markdown-chart-0"');
    expect(html).not.toContain('renderer');
    expect(getMarkdownChartBlocks(env)).toEqual([{
      id: 'markdown-chart-0',
      language: 'markdown-chart',
      source: '{"version":1,"renderer":"echarts","data":{"kind":"inline","source":[]},"spec":{}}\n',
    }]);
  });

  it('leaves unrelated fenced code unchanged', () => {
    const md = new MarkdownIt().use(markdownChartPlugin);
    const env: MarkdownChartEnvironment = {};
    const html = md.render('```ts\nconst answer = 42\n```', env);
    expect(html).toContain('<code class="language-ts">');
    expect(getMarkdownChartBlocks(env)).toEqual([]);
  });

  it('does not treat the old chart fence as canonical', () => {
    const md = new MarkdownIt().use(markdownChartPlugin);
    const env: MarkdownChartEnvironment = {};
    const html = md.render('```chart\n{}\n```', env);
    expect(html).toContain('<code class="language-chart">');
    expect(getMarkdownChartBlocks(env)).toEqual([]);
  });

  it('consults the live registry for future renderer aliases', () => {
    const registry = new ChartRendererRegistry();
    const md = new MarkdownIt().use(markdownChartPlugin, { registry });
    registry.register({
      id: 'vega',
      aliases: ['vega-lite'],
      parse: (spec) => spec,
      mount() {},
    });
    const env: MarkdownChartEnvironment = {};
    const html = md.render('```vega-lite\n{"mark":"bar"}\n```', env);
    expect(html).toContain('markdown-chart-placeholder');
    expect(getMarkdownChartBlocks(env)[0]?.language).toBe('vega-lite');
  });

  it('supports a live host language predicate without renderer defaults', () => {
    const aliases = new Set<string>();
    const md = new MarkdownIt().use(markdownChartPlugin, {
      isChartLanguage: (language) => aliases.has(language),
    });
    aliases.add('plotly-json');
    const env: MarkdownChartEnvironment = {};
    const html = md.render('```plotly-json\n{"data":[]}\n```', env);
    expect(html).toContain('markdown-chart-placeholder');
    expect(getMarkdownChartBlocks(env)[0]?.language).toBe('plotly-json');
  });

  it('rejects unsafe placeholder configuration', () => {
    const md = new MarkdownIt();
    expect(() => md.use(markdownChartPlugin, { idPrefix: 'bad\" onclick="alert(1)' }))
      .toThrowError(/idPrefix/);
  });
});
