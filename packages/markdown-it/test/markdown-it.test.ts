import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import {
  createMarkdownChartEnvironment,
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
      complete: true,
    }]);
  });

  it('marks only an unterminated chart fence as incomplete while streaming', () => {
    const md = new MarkdownIt({ html: false }).use(markdownChartPlugin);
    const completeSource = '```markdown-chart\n{"version":1,"renderer":"echarts","spec":{}}\n```\n\nMore text';
    const completeEnv = createMarkdownChartEnvironment({ streaming: true });
    const completeHtml = md.render(completeSource, completeEnv);
    expect(getMarkdownChartBlocks(completeEnv)[0]?.complete).toBe(true);
    expect(completeHtml).toContain('data-markdown-chart-complete="true"');
    expect(completeHtml).not.toContain('aria-busy="true"');

    const incompleteSource = '```markdown-chart\n{"version":1';
    const incompleteEnv = createMarkdownChartEnvironment({ streaming: true });
    const incompleteHtml = md.render(incompleteSource, incompleteEnv);
    expect(getMarkdownChartBlocks(incompleteEnv)[0]?.complete).toBe(false);
    expect(incompleteHtml).toContain('markdown-chart-streaming');
    expect(incompleteHtml).toContain('aria-busy="true"');
  });

  it('keeps completed charts renderable when the final chart fence is still streaming', () => {
    const md = new MarkdownIt({ html: false }).use(markdownChartPlugin);
    const source = [
      '```markdown-chart',
      '{"version":1,"renderer":"echarts","spec":{}}',
      '```',
      '',
      '```markdown-chart',
      '{"version":1',
    ].join('\n');
    const env = createMarkdownChartEnvironment({ streaming: true });
    md.render(source, env);
    expect(getMarkdownChartBlocks(env).map((block) => block.complete)).toEqual([true, false]);
  });

  it('treats an implicitly closed container fence followed by text as complete', () => {
    const md = new MarkdownIt({ html: false }).use(markdownChartPlugin);
    const source = [
      '> ```markdown-chart',
      '> {"version":1,"renderer":"echarts","spec":{}}',
      '',
      'Following paragraph',
    ].join('\n');
    const env = createMarkdownChartEnvironment({ streaming: true });
    md.render(source, env);
    expect(getMarkdownChartBlocks(env)[0]?.complete).toBe(true);
  });

  it('handles tilde fences and rejects a closing marker shorter than the opener', () => {
    const md = new MarkdownIt({ html: false }).use(markdownChartPlugin);
    const tildeSource = '~~~markdown-chart\n{"version":1}\n~~~';
    const tildeEnv = createMarkdownChartEnvironment({ streaming: true });
    md.render(tildeSource, tildeEnv);
    expect(getMarkdownChartBlocks(tildeEnv)[0]?.complete).toBe(true);

    const shortClosing = '````markdown-chart\n{"version":1}\n```';
    const shortEnv = createMarkdownChartEnvironment({ streaming: true });
    md.render(shortClosing, shortEnv);
    expect(getMarkdownChartBlocks(shortEnv)[0]?.complete).toBe(false);
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
