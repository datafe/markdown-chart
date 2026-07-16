// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  isMarkdownFenceClosed,
  MarkdownChartError,
  parseChartJson,
  parseMarkdownChartEnvelope,
  type ChartRenderer,
} from '../src/index';

describe('ChartRendererRegistry', () => {
  it('routes canonical markdown-chart envelopes without renderer-specific core switches', async () => {
    const plotly: ChartRenderer<string> = {
      id: 'plotly',
      aliases: ['plotly-json'],
      parse(spec) {
        return JSON.stringify(spec);
      },
      mount() {},
    };
    const registry = new ChartRendererRegistry().register(plotly);

    const prepared = await registry.prepare('markdown-chart', JSON.stringify({
      version: 1,
      renderer: 'plotly',
      data: {
        kind: 'inline',
        dimensions: ['name', 'value'],
        source: [['A', 1]],
      },
      spec: { traces: [] },
    }));

    expect(prepared.rendererId).toBe('plotly');
    expect(prepared.parsed).toBe('{"traces":[]}');
    expect(prepared.data).toEqual({
      kind: 'inline',
      dimensions: ['name', 'value'],
      source: [['A', 1]],
    });
  });

  it('routes renderer-specific aliases', async () => {
    const registry = new ChartRendererRegistry().register({
      id: 'vega',
      aliases: ['vega-lite'],
      parse: (spec) => spec,
      mount() {},
    });
    const prepared = await registry.prepare('vega-lite extra-info', '{"mark":"bar"}');
    expect(prepared.rendererId).toBe('vega');
    expect(prepared.language).toBe('vega-lite');
  });

  it('routes matched dynamic languages without interpreting their source', async () => {
    const parseSource = vi.fn((source: string) => ({ source }));
    const registry = new ChartRendererRegistry().register({
      id: 'temporary',
      matchLanguage: (language) => /^temporary-\d+$/.test(language),
      parse: (spec) => spec,
      parseSource,
      mount() {},
    });

    expect(registry.has('temporary-42')).toBe(true);
    const prepared = await registry.prepare('temporary-42', 'not json');
    expect(parseSource).toHaveBeenCalledWith('not json', {
      language: 'temporary-42',
      rendererId: 'temporary',
      data: undefined,
    });
    expect(prepared.parsed).toEqual({ source: 'not json' });
  });

  it('rejects ambiguous dynamic language matches', async () => {
    const registry = new ChartRendererRegistry()
      .register({
        id: 'first',
        matchLanguage: () => true,
        parse: (spec) => spec,
        parseSource: (source) => source,
        mount() {},
      })
      .register({
        id: 'second',
        matchLanguage: () => true,
        parse: (spec) => spec,
        parseSource: (source) => source,
        mount() {},
      });

    await expect(registry.prepare('dynamic', 'source'))
      .rejects.toMatchObject({ code: 'RENDERER_CONFLICT' });
  });

  it('applies source size limits to matched dynamic languages', async () => {
    const parseSource = vi.fn((source: string) => source);
    const registry = new ChartRendererRegistry({
      jsonLimits: { maxCharacters: 4 },
    }).register({
      id: 'temporary',
      matchLanguage: () => true,
      parse: (spec) => spec,
      parseSource,
      mount() {},
    });

    await expect(registry.prepare('temporary', 'too long'))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(parseSource).not.toHaveBeenCalled();
  });

  it('rejects aliases owned by another renderer', () => {
    const registry = new ChartRendererRegistry().register({
      id: 'first',
      aliases: ['shared'],
      parse: (spec) => spec,
      mount() {},
    });
    expect(() => registry.register({
      id: 'second',
      aliases: ['shared'],
      parse: (spec) => spec,
      mount() {},
    })).toThrowError(MarkdownChartError);
  });
});

describe('ChartController', () => {
  it('disposes the previous chart before mounting an update', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    let mounts = 0;
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount() {
        mounts += 1;
        return { dispose: mounts === 1 ? firstDispose : secondDispose };
      },
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');

    await controller.render(element, { language: 'test', source: '{}' });
    await controller.render(element, { language: 'test', source: '{}' });
    expect(firstDispose).toHaveBeenCalledOnce();
    controller.dispose();
    expect(secondDispose).toHaveBeenCalledOnce();
  });

  it('does not parse incomplete streaming input', async () => {
    const parse = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse,
      mount() {},
    });
    const controller = new ChartController(registry);
    await controller.render(document.createElement('div'), {
      language: 'test',
      source: '{',
      streaming: true,
    });
    expect(parse).not.toHaveBeenCalled();
  });

  it('keeps the last completed chart mounted while a block update is incomplete', async () => {
    const parse = vi.fn((spec) => spec);
    const dispose = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse,
      mount() {
        return { dispose };
      },
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    await controller.render(element, { language: 'test', source: '{}' });
    await controller.render(element, {
      language: 'test',
      source: '{',
      streaming: true,
    });
    expect(parse).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    controller.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('provides chart and canonical inline data views without remounting the chart', async () => {
    const resize = vi.fn();
    const dispose = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount(container) {
        container.dataset.mounted = 'true';
        return { resize, dispose };
      },
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    await controller.render(element, {
      language: 'markdown-chart',
      source: JSON.stringify({
        version: 1,
        renderer: 'test',
        data: {
          kind: 'inline',
          dimensions: ['month', 'sales'],
          source: [['Jan', 100], ['<script>', null]],
        },
        spec: {},
      }),
    });

    const chartView = element.querySelector<HTMLElement>('[data-markdown-chart-chart-view]');
    const dataView = element.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    const showChart = element.querySelector<HTMLButtonElement>('button[aria-label="Show chart"]');
    const showData = element.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    expect(chartView?.dataset.mounted).toBe('true');
    expect(dataView?.hidden).toBe(true);

    showData?.click();
    expect(chartView?.hidden).toBe(true);
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.textContent).toContain('Jan');
    expect(dataView?.textContent).toContain('<script>');
    expect(dataView?.querySelector('script')).toBeNull();
    expect(dispose).not.toHaveBeenCalled();

    showChart?.click();
    expect(chartView?.hidden).toBe(false);
    expect(resize).toHaveBeenCalledOnce();
    controller.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});

describe('isMarkdownFenceClosed', () => {
  it('recognizes matching backtick and tilde closing fences', () => {
    expect(isMarkdownFenceClosed('```markdown-chart\n{}\n```')).toBe(true);
    expect(isMarkdownFenceClosed('~~~~markdown-chart\n{}\n~~~~')).toBe(true);
    expect(isMarkdownFenceClosed('````markdown-chart\n```\n````')).toBe(true);
  });

  it('rejects unterminated or too-short closing fences', () => {
    expect(isMarkdownFenceClosed('```markdown-chart\n{}')).toBe(false);
    expect(isMarkdownFenceClosed('````markdown-chart\n{}\n```')).toBe(false);
  });
});

describe('parseChartJson', () => {
  it('rejects prototype-related keys', () => {
    expect(() => parseChartJson('{"__proto__":{"polluted":true}}'))
      .toThrowError(/forbidden key/);
  });

  it('enforces source size limits before parsing', () => {
    expect(() => parseChartJson('{"long":"value"}', { maxCharacters: 4 }))
      .toThrowError(/character limit/);
  });
});

describe('parseMarkdownChartEnvelope', () => {
  it('exposes inline data independently from the renderer spec', () => {
    const envelope = parseMarkdownChartEnvelope(JSON.stringify({
      version: 1,
      renderer: 'echarts',
      data: {
        kind: 'inline',
        dimensions: ['category', 'value'],
        source: [['A', 10], ['B', 20]],
      },
      spec: { series: [{ type: 'bar' }] },
    }));

    expect(envelope.data).toEqual({
      kind: 'inline',
      dimensions: ['category', 'value'],
      source: [['A', 10], ['B', 20]],
    });
    expect(envelope.spec).toEqual({ series: [{ type: 'bar' }] });
  });

  it('rejects malformed canonical data before invoking a renderer', () => {
    expect(() => parseMarkdownChartEnvelope(JSON.stringify({
      version: 1,
      renderer: 'echarts',
      data: { kind: 'inline', source: [['A', { nested: true }]] },
      spec: {},
    }))).toThrowError(/JSON scalars/);
  });
});
