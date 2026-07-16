// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  MarkdownChartError,
  type JsonValue,
} from '@datafe/markdown-chart';
import {
  createEChartsRenderer,
  type EChartsRuntime,
} from '../src/index';

function fakeRuntime(onOption: (option: Record<string, JsonValue>) => void): {
  runtime: EChartsRuntime;
  dispose: ReturnType<typeof vi.fn>;
} {
  const dispose = vi.fn();
  return {
    dispose,
    runtime: {
      init() {
        return {
          setOption: onOption,
          resize() {},
          dispose,
        };
      },
    },
  };
}

describe('createEChartsRenderer', () => {
  it('can be created without an explicit ECharts loader', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    await expect(registry.prepare('echarts', '{"series":[]}'))
      .resolves.toMatchObject({ rendererId: 'echarts' });
  });

  it('injects canonical inline data from outside the renderer spec', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const controller = new ChartController(registry);

    await controller.render(document.createElement('div'), {
      language: 'markdown-chart',
      source: JSON.stringify({
        version: 1,
        renderer: 'echarts',
        data: {
          kind: 'inline',
          dimensions: ['name', 'value'],
          source: [['A', 1], ['B', 2]],
        },
        spec: {
          xAxis: { type: 'category' },
          yAxis: {},
          series: [{ type: 'bar' }],
        },
      }),
    });

    expect(rendered?.dataset).toEqual({
      dimensions: ['name', 'value'],
      source: [['A', 1], ['B', 2]],
    });
    controller.dispose();
    expect(fake.dispose).toHaveBeenCalledOnce();
  });

  it('applies WebShell-inspired light defaults while preserving explicit values', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));

    await new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts',
      source: JSON.stringify({
        backgroundColor: '#fafafa',
        xAxis: { type: 'category', axisLabel: { color: '#ff0000' } },
        yAxis: {},
        series: [{ type: 'bar', barMaxWidth: 64 }],
      }),
    });

    expect(rendered).toMatchObject({
      backgroundColor: '#fafafa',
      grid: { top: 24, right: 36, bottom: 48, left: 24, containLabel: true },
      tooltip: { trigger: 'axis', confine: true, renderMode: 'richText' },
      xAxis: {
        axisLabel: { color: '#ff0000', fontSize: 12, hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: { splitLine: { show: true } },
      series: [{
        type: 'bar',
        barMaxWidth: 64,
        barCategoryGap: '48%',
        itemStyle: { borderRadius: [3, 3, 0, 0] },
      }],
    });
    expect(rendered?.color).toEqual(expect.arrayContaining(['#6250F9', '#33AFA9']));
  });

  it('supports dark defaults and an explicit default-style opt-out', async () => {
    const rendered: Array<Record<string, JsonValue>> = [];
    const fake = fakeRuntime((option) => { rendered.push(option); });
    const styledRegistry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    await new ChartController(styledRegistry).render(document.createElement('div'), {
      language: 'echarts',
      source: '{"series":[{"type":"line"}]}',
      theme: 'dark',
    });

    const plainRegistry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
      defaultStyle: false,
    }));
    await new ChartController(plainRegistry).render(document.createElement('div'), {
      language: 'echarts',
      source: '{"series":[{"type":"line"}]}',
    });

    expect(rendered[0]).toMatchObject({
      backgroundColor: '#0d0d0d',
      textStyle: { color: '#f4f7ff' },
      series: [{ type: 'line', symbol: 'circle', symbolSize: 4 }],
    });
    expect(rendered[0]?.color).toEqual(expect.arrayContaining(['#8AA0FF', '#60CCC5']));
    expect(rendered[1]).toEqual({ series: [{ type: 'line' }] });
  });

  it('rejects renderer-specific data envelopes inside canonical spec', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('markdown-chart', JSON.stringify({
      version: 1,
      renderer: 'echarts',
      spec: {
        data: { kind: 'inline', source: [['A', 1]] },
        option: { series: [{ type: 'bar' }] },
      },
    }))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('resolves the temporary ChatBI query fence through a host callback', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const resolveLegacyEChartQuery = vi.fn(async () => ({
      data: {
        kind: 'inline' as const,
        dimensions: ['name', 'value'],
        source: [{ name: 'A', value: 10 }, { name: 'B', value: 20 }],
      },
      spec: {
        xAxis: { type: 'category' },
        yAxis: {},
        series: [{ type: 'bar', encode: { x: 'name', y: 'value' } }],
      },
    }));
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveLegacyEChartQuery,
      resizeObserver: false,
    }));

    await new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = { series: [] };\n//#end',
    });

    expect(resolveLegacyEChartQuery).toHaveBeenCalledWith(expect.objectContaining({
      language: 'echarts-chatbi_query_8660210443288600709-0',
      jobId: 'chatbi_query_8660210443288600709',
      index: 0,
      source: 'var option = { series: [] };\n//#end',
      signal: expect.any(AbortSignal),
    }));
    expect(rendered?.dataset).toEqual({
      dimensions: ['name', 'value'],
      source: [{ name: 'A', value: 10 }, { name: 'B', value: 20 }],
    });
  });

  it('accepts legacy resolver data over 500 KB within ECharts row and cell limits', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const source = Array.from({ length: 2_000 }, (_, rowIndex) => (
      Array.from({ length: 20 }, (_, columnIndex) => (
        `${rowIndex}-${columnIndex}-${'x'.repeat(16)}`
      ))
    ));
    const resolved = {
      data: {
        kind: 'inline' as const,
        dimensions: Array.from({ length: 20 }, (_, index) => `column_${index}`),
        source,
      },
      spec: { series: [{ type: 'bar' }] },
    };
    expect(JSON.stringify(resolved).length).toBeGreaterThan(500_000);
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveLegacyEChartQuery: async () => resolved,
      resizeObserver: false,
    }));

    await new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
    });

    const dataset = rendered?.dataset as Record<string, JsonValue> | undefined;
    expect(dataset?.source).toHaveLength(2_000);
  });

  it('requires a host callback for the temporary ChatBI query fence', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
    })).rejects.toMatchObject({ code: 'REF_RESOLVER_MISSING' });
  });

  it('revalidates temporary ChatBI resolver output before loading ECharts', async () => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts,
      resolveLegacyEChartQuery: async () => ({
        data: { kind: 'inline', source: [] },
        spec: { tooltip: { formatter: '{b}' }, series: [] },
      }),
    }));

    await expect(new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
    })).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it('rejects non-JSON prototypes returned by the temporary resolver', async () => {
    const loadECharts = vi.fn();
    const spec = Object.assign(Object.create({ inherited: true }) as Record<string, JsonValue>, {
      series: [],
    });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts,
      resolveLegacyEChartQuery: async () => ({
        data: { kind: 'inline', source: [] },
        spec,
      }),
    }));

    await expect(new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
    })).rejects.toMatchObject({ code: 'INVALID_JSON' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it('resolves opaque data references only through the injected resolver', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const resolver = vi.fn(async () => ({
      dimensions: ['month', 'sales'],
      source: [['Jan', 100]],
    }));
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveDataRef: resolver,
      validateDataRef: (ref) => ref.startsWith('app://'),
      resizeObserver: false,
    }));

    await new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-fulldata',
      source: JSON.stringify({
        data: { kind: 'ref', ref: 'app://datasets/sales', format: 'json' },
        option: { series: [{ type: 'line' }] },
      }),
    });

    expect(resolver).toHaveBeenCalledOnce();
    expect(rendered?.dataset).toEqual({
      dimensions: ['month', 'sales'],
      source: [['Jan', 100]],
    });
  });

  it('fails closed when a ref resolver is missing', async () => {
    const fake = fakeRuntime(() => undefined);
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const promise = new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts',
      source: JSON.stringify({
        data: { kind: 'ref', ref: 'app://datasets/sales' },
        option: { series: [] },
      }),
    });
    await expect(promise).rejects.toMatchObject({
      code: 'REF_RESOLVER_MISSING',
    });
  });

  it('rejects URL-bearing options before loading ECharts', async () => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({ loadECharts }));
    await expect(registry.prepare('echarts', JSON.stringify({
      series: [{ type: 'line', symbol: 'image://https://example.test/tracker.png' }],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it.each([
    ['link', 'https://example.test/'],
    ['sublink', 'https://example.test/subtitle'],
    ['href', '/relative-target'],
    ['src', '/relative-image.png'],
    ['url', '/relative-resource'],
    ['imageUrl', '/relative-image.png'],
  ])('rejects URL-bearing key %s even when its value has no absolute protocol', async (key, value) => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      title: { text: 'chart', [key]: value },
      series: [],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
  });

  it.each([
    ['java\\nscript', 'java\nscript:alert(1)'],
    ['java\\tscript', 'java\tscript:alert(1)'],
    ['vbscript', 'vbscript:msgbox(1)'],
  ])('rejects obfuscated or legacy protocol %s', async (_label, value) => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      title: { text: value },
      series: [],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
  });

  it('does not mistake dataZoom or visualMap for URL-bearing keys', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      dataZoom: [{ type: 'inside' }],
      visualMap: { min: 0, max: 100 },
      series: [],
    }))).resolves.toMatchObject({ rendererId: 'echarts' });
  });

  it.each([
    ['tooltip CSS injection', {
      tooltip: { extraCssText: 'background-image:url(javascript:alert(1))' },
      series: [],
    }],
    ['dataset transform regular expression', {
      dataset: {
        source: [['name'], ['aaaaaaaaaaaaaaaa!']],
        transform: {
          type: 'filter',
          config: { dimension: 'name', reg: '^(a+)+$' },
        },
      },
      series: [],
    }],
    ['formatter surface', { tooltip: { formatter: '{b}: {c}' }, series: [] }],
    ['toolbox data view surface', { toolbox: { feature: { dataView: {} } }, series: [] }],
    ['custom renderer surface', { series: [{ type: 'custom', renderItem: 'return value' }] }],
    ['graphic surface', { graphic: [{ type: 'rect', shape: { width: 1, height: 1 } }], series: [] }],
    ['image surface', { series: [{ type: 'bar', symbol: 'image://https://example.test/a.png' }] }],
    ['URL surface', { title: { text: 'chart', link: 'https://example.test/' }, series: [] }],
    ['HTML surface', { title: { text: '<img src=x onerror=alert(1)>' }, series: [] }],
  ])('rejects unsafe %s', async (_label, option) => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({ loadECharts }));
    await expect(registry.prepare('echarts', JSON.stringify(option)))
      .rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level ECharts surfaces', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      futureExecutableSurface: { enabled: true },
      series: [],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
  });

  it('rejects custom series and dataset conflicts', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      series: [{ type: 'custom' }],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    await expect(registry.prepare('echarts', JSON.stringify({
      data: { kind: 'inline', source: [] },
      option: { dataset: { source: [] } },
    }))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('rejects a renderer-level version because version belongs to markdown-chart', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      version: 1,
      option: { series: [] },
    }))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('applies dataset limits to direct ECharts options', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
      limits: { maxRows: 1 },
    }));
    await expect(registry.prepare('echarts', JSON.stringify({
      dataset: { source: [['A', 1], ['B', 2]] },
      series: [{ type: 'bar' }],
    }))).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('disposes the ECharts instance when setOption throws', async () => {
    const fake = fakeRuntime(() => { throw new Error('setOption failed'); });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    await expect(new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts',
      source: '{"series":[]}',
    })).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    expect(fake.dispose).toHaveBeenCalledOnce();
  });

  it('disconnects the observer and disposes the instance when observer setup throws', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {
        throw new Error('observe failed');
      }

      unobserve(): void {}

      disconnect(): void {
        disconnect();
      }
    });
    const fake = fakeRuntime(() => undefined);
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
    }));
    try {
      await expect(new ChartController(registry).render(document.createElement('div'), {
        language: 'echarts',
        source: '{"series":[]}',
      })).rejects.toMatchObject({ code: 'RENDER_FAILED' });
      expect(disconnect).toHaveBeenCalledOnce();
      expect(fake.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
