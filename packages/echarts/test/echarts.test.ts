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
  it('injects inline data and supports the echarts shorthand fence', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const controller = new ChartController(registry);

    await controller.render(document.createElement('div'), {
      language: 'echarts',
      source: JSON.stringify({
        version: 1,
        data: {
          kind: 'inline',
          dimensions: ['name', 'value'],
          source: [['A', 1], ['B', 2]],
        },
        option: {
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
        version: 1,
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
        version: 1,
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
      version: 1,
      data: { kind: 'inline', source: [] },
      option: { dataset: { source: [] } },
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
