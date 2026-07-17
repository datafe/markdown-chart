// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  isMarkdownFenceClosed,
  MarkdownChartError,
  parseChartJson,
  parseMarkdownChartEnvelope,
  validateChartJsonValue,
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
    expect(registry.has('plotly')).toBe(false);
    await expect(registry.prepare('plotly', '{"traces":[]}'))
      .rejects.toMatchObject({ code: 'RENDERER_NOT_FOUND' });
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
      aliases: ['test'],
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
      aliases: ['test'],
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
      aliases: ['test'],
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

  it('invalidates an in-flight mount when an incomplete streaming update arrives', async () => {
    let finishMount: ((handle: { dispose(): void }) => void) | undefined;
    let mountSignal: AbortSignal | undefined;
    const staleDispose = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse: (spec) => spec,
      mount(_container, _parsed, context) {
        mountSignal = context.signal;
        return new Promise<{ dispose(): void }>((resolve) => {
          finishMount = resolve;
        });
      },
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    const render = controller.render(element, {
      language: 'markdown-chart',
      source: JSON.stringify({
        version: 1,
        renderer: 'test',
        data: { kind: 'inline', dimensions: ['value'], source: [[1]] },
        spec: {},
      }),
    });
    await vi.waitFor(() => expect(finishMount).toBeTypeOf('function'));
    expect(element.classList.contains('markdown-chart-card')).toBe(true);

    await controller.render(element, { language: 'test', source: '{', streaming: true });
    expect(mountSignal?.aborted).toBe(true);
    expect(element.classList.contains('markdown-chart-card')).toBe(false);
    expect(element.childElementCount).toBe(0);

    finishMount?.({ dispose: staleDispose });
    await render;
    expect(staleDispose).toHaveBeenCalledOnce();
  });

  it('prevents an in-flight prepare from mounting after a streaming update', async () => {
    let finishParse: ((parsed: unknown) => void) | undefined;
    const mount = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse() {
        return new Promise((resolve) => {
          finishParse = resolve;
        });
      },
      mount,
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    const render = controller.render(element, {
      language: 'test',
      source: '{}',
    });
    await vi.waitFor(() => expect(finishParse).toBeTypeOf('function'));

    await controller.render(element, {
      language: 'test',
      source: '{',
      streaming: true,
    });
    finishParse?.({});
    await render;
    expect(mount).not.toHaveBeenCalled();
  });

  it('materializes renderer data before creating the data view and mounting', async () => {
    const order: string[] = [];
    const parse = vi.fn((spec) => {
      order.push('parse');
      return spec;
    });
    const materialize = vi.fn((parsed, context) => {
      order.push('materialize');
      expect(context).toMatchObject({
        language: 'test',
        rendererId: 'test',
        data: undefined,
        theme: 'dark',
      });
      expect(context.signal).toBeInstanceOf(AbortSignal);
      return {
        parsed: { original: parsed, resolved: true },
        data: {
          kind: 'inline' as const,
          dimensions: ['name', 'value'],
          source: [['A', 10]],
        },
      };
    });
    const mount = vi.fn((container, parsed) => {
      order.push('mount');
      expect(parsed).toEqual({ original: {}, resolved: true });
      container.dataset.mounted = 'true';
    });
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse,
      materialize,
      mount,
    });
    const element = document.createElement('div');

    await new ChartController(registry).render(element, {
      language: 'test',
      source: '{}',
      theme: 'dark',
    });

    expect(order).toEqual(['parse', 'materialize', 'mount']);
    expect(parse).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledOnce();
    expect(element.querySelector('[data-markdown-chart-chart-view]')?.getAttribute('data-mounted'))
      .toBe('true');
    const showData = element.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    showData?.click();
    const dataView = element.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.querySelector('tbody')?.textContent).toContain('A10');
  });

  it('aborts and discards an in-flight materialization before mount', async () => {
    let finishMaterialize: ((value: { parsed: unknown; data: undefined }) => void) | undefined;
    let materializeSignal: AbortSignal | undefined;
    const mount = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse: (spec) => spec,
      materialize(parsed, context) {
        materializeSignal = context.signal;
        return new Promise((resolve) => {
          finishMaterialize = resolve;
        });
      },
      mount,
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    const render = controller.render(element, { language: 'test', source: '{}' });
    await vi.waitFor(() => expect(finishMaterialize).toBeTypeOf('function'));

    await controller.render(element, { language: 'test', source: '{', streaming: true });
    expect(materializeSignal?.aborted).toBe(true);
    finishMaterialize?.({ parsed: {}, data: undefined });
    await render;
    expect(mount).not.toHaveBeenCalled();
    expect(element.childElementCount).toBe(0);
  });

  it('provides chart and canonical inline data views without remounting the chart', async () => {
    const resize = vi.fn();
    const dispose = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
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
          dimensions: ['month', 'sales', 'empty', 'missing'],
          source: [
            ['Jan', 100, ''],
            { month: '<script>', sales: null, empty: '' },
          ],
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
    expect(showChart?.title).toBe('Chart');
    expect(showData?.title).toBe('Data');
    expect(showChart?.textContent).toBe('');
    expect(showData?.textContent).toBe('');
    expect(showChart?.querySelector('svg')).not.toBeNull();
    expect(showData?.querySelector('svg')).not.toBeNull();
    expect(element.querySelector('.markdown-chart-toggle')?.getAttribute('role')).toBe('group');

    showData?.click();
    expect(chartView?.hidden).toBe(true);
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.textContent).toContain('Jan');
    expect(dataView?.textContent).toContain('<script>');
    expect(dataView?.querySelector('script')).toBeNull();
    expect([...dataView?.querySelectorAll('tbody td') ?? []].map((cell) => cell.textContent)).toEqual([
      'Jan', '100', '""', 'undefined',
      '<script>', 'null', '""', 'undefined',
    ]);
    expect(dispose).not.toHaveBeenCalled();

    showChart?.click();
    expect(chartView?.hidden).toBe(false);
    expect(resize).toHaveBeenCalledOnce();
    controller.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('restores host classes and inline styles before a render without inline data', async () => {
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse: (spec) => spec,
      mount() {
        return { dispose() {} };
      },
    });
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    element.className = 'host-chart';
    element.style.overflow = 'auto';
    element.style.border = '2px solid red';
    element.style.borderRadius = '3px';

    await controller.render(element, {
      language: 'markdown-chart',
      source: JSON.stringify({
        version: 1,
        renderer: 'test',
        data: { kind: 'inline', source: [['A', 1]] },
        spec: {},
      }),
    });
    expect(element.classList.contains('markdown-chart-card')).toBe(true);

    await controller.render(element, { language: 'test', source: '{}' });
    expect(element.className).toBe('host-chart');
    expect(element.style.overflow).toBe('auto');
    expect(element.style.border).toBe('2px solid red');
    expect(element.style.borderRadius).toBe('3px');
    controller.dispose();
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

  it('validates materialized JSON values without a character limit', () => {
    const value = { rows: ['x'.repeat(500_001)] };
    expect(validateChartJsonValue(value)).toBe(value);
    expect(() => validateChartJsonValue(Object.create({ inherited: true })))
      .toThrowError(/non-JSON value/);
    expect(() => validateChartJsonValue(JSON.parse('{"constructor":{}}')))
      .toThrowError(/forbidden key/);
    expect(() => validateChartJsonValue(new Array(1)))
      .toThrowError(/not a JSON data property/);
    expect(() => validateChartJsonValue(Object.defineProperty({}, 'value', { get: () => 1 })))
      .toThrowError(/not a JSON data property/);
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
