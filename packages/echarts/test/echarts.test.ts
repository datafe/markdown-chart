// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  MarkdownChartError,
  type JsonValue,
} from '@datafe-open/markdown-chart';
import {
  applyEChartsDefaultStyle,
  createLegacySandboxClient,
  createEChartsRenderer,
  LegacySandboxError,
  type CreateEChartsRendererOptions,
  type EChartsRuntime,
  type LegacySandboxBinding,
  type LegacySandboxFile,
  type LegacySandboxTransport,
  type ParsedEChartsSpec,
  type ResolvedDataset,
  type ResolvedLegacyEChartQuery,
} from '../src/index';

const LEGACY_CHANNEL = '@datafe-open/markdown-chart/legacy-echart-query';
const LEGACY_REQUEST_ID = '00000001000000020000000300000004';
const LIGHT_SERIES_PALETTE = [
  '#6250F9', '#33AFA9', '#AB7BFF', '#5F99F9',
  '#A9AFFF', '#60CCC5', '#C2A5FF', '#8EB8FE',
  '#E0E3FE', '#98E3DD', '#E8E1FA', '#D7E6FF',
];
const DARK_SERIES_PALETTE = [
  '#8EA0FF', '#61D6D1', '#C8A7FF', '#8EB8FE',
  '#C7CCFF', '#8DE7E2', '#D8C5FF', '#B8D2FF',
  '#EEF0FF', '#C2F0ED', '#F0EAFE', '#E8F1FF',
];

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: ArrayBufferView) => {
    if (array instanceof Uint32Array) {
      array.set([1, 2, 3, 4]);
    }
    return array;
  }) as Crypto['getRandomValues']);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

function canonical(spec: JsonValue, data?: JsonValue): string {
  return JSON.stringify({
    version: 1,
    renderer: 'echarts',
    ...(data === undefined ? {} : { data }),
    spec,
  });
}

function compact(option: JsonValue, data: JsonValue): string {
  return JSON.stringify({ version: 1, data, option });
}

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

const THIRTY_DAY_DATES = Array.from(
  { length: 30 },
  (_, index) => `2017-12-${String(index + 1).padStart(2, '0')}`,
);

function thirtyDayTrendOption(): Record<string, JsonValue> {
  return {
    title: { text: '最近30天各品类日销售额趋势', left: 'center' },
    legend: {
      top: '10%',
      data: ['Furniture', 'Office Supplies', 'Technology'],
    },
    grid: { bottom: 3, containLabel: true },
    xAxis: {
      type: 'category',
      data: THIRTY_DAY_DATES,
      axisLabel: { rotate: 45 },
    },
    yAxis: { type: 'value', name: '销售额 ($)' },
    series: [
      { name: 'Furniture', type: 'line', smooth: true, encode: { x: 'date', y: 'furniture' } },
      { name: 'Office Supplies', type: 'line', smooth: true, encode: { x: 'date', y: 'office' } },
      { name: 'Technology', type: 'line', smooth: true, encode: { x: 'date', y: 'technology' } },
    ],
  };
}

function thirtyDayTrendData(): JsonValue {
  return {
    kind: 'inline',
    dimensions: ['date', 'furniture', 'office', 'technology'],
    source: THIRTY_DAY_DATES.map((date, index) => [
      date,
      (index * 733) % 4_100,
      (index * 419) % 2_700,
      (index * 947) % 3_800,
    ]),
  };
}

async function answerLegacySandbox(option: Record<string, JsonValue>): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).not.toBeNull();
  });
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Temporary chart sandbox"]');
  if (!iframe?.contentWindow) throw new Error('temporary sandbox is missing');
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow,
    data: {
      channel: LEGACY_CHANNEL,
      type: 'result',
      requestId: LEGACY_REQUEST_ID,
      option,
    },
  }));
}

describe('createEChartsRenderer', () => {
  it('uses the first non-empty ECharts title as the shared card title', async () => {
    const renderer = createEChartsRenderer();
    const parsed = await renderer.parse({
      title: [{ text: '   ' }, { text: 'Olympic participation by gender' }],
      series: [],
    }, {
      language: 'markdown-chart',
      rendererId: 'echarts',
      data: undefined,
    });

    expect(renderer.getTitle?.(parsed)).toBe('Olympic participation by gender');
    expect(renderer.getTitle?.({ ...parsed, option: { series: [] } })).toBeUndefined();
  });

  it('registers only the exact dataworks-chart compact alias', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    expect(registry.has('echarts')).toBe(false);
    expect(registry.has('echarts-fulldata')).toBe(true);
    expect(registry.has('echart-fulldata')).toBe(false);
    await expect(registry.prepare('echarts', '{"series":[]}'))
      .rejects.toMatchObject({ code: 'RENDERER_NOT_FOUND' });
    await expect(registry.prepare('echarts-fulldata', compact(
      { series: [] },
      { kind: 'inline', dimensions: ['name'], source: [['A']] },
    ))).resolves.toMatchObject({ rendererId: 'echarts' });
    await expect(registry.prepare('markdown-chart', canonical({ series: [] })))
      .resolves.toMatchObject({ rendererId: 'echarts' });
  });

  it('normalizes compact inline data into the shared title and Data view', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const container = document.createElement('div');
    const controller = new ChartController(registry);
    await controller.render(container, {
      language: 'echarts-fulldata',
      source: compact(
        { title: { text: 'Compact chart' }, series: [{ type: 'bar' }] },
        {
          kind: 'inline',
          dimensions: ['name', 'value'],
          source: [['A', 1], ['B', 2]],
        },
      ),
    });

    expect(container.querySelector('.markdown-chart-title')?.textContent).toBe('Compact chart');
    expect(container.querySelectorAll('.markdown-chart-title')).toHaveLength(1);
    expect(rendered).not.toHaveProperty('title');
    expect(rendered?.dataset).toEqual({
      dimensions: ['name', 'value'],
      source: [['A', 1], ['B', 2]],
    });
    const showData = container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    expect(showData).not.toBeNull();
    showData?.click();
    expect(container.querySelector('thead')?.textContent).toContain('namevalue');
    expect(container.querySelector('tbody')?.textContent).toContain('A1');
    controller.dispose();
  });

  it('keeps native ECharts titles without an inline card and on direct mounts', async () => {
    const rendered: Array<Record<string, JsonValue>> = [];
    const fake = fakeRuntime((option) => { rendered.push(option); });
    const renderer = createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    });
    const registry = new ChartRendererRegistry().register(renderer);
    const controller = new ChartController(registry);
    const container = document.createElement('div');

    await controller.render(container, {
      language: 'markdown-chart',
      source: canonical({ title: { text: 'No card title' }, series: [] }),
    });

    const parsed = await renderer.parse({ title: { text: 'Direct title' }, series: [] }, {
      language: 'markdown-chart',
      rendererId: 'echarts',
      data: undefined,
    });
    const directHandle = await renderer.mount(document.createElement('div'), parsed, {
      signal: new AbortController().signal,
      theme: undefined,
    });

    expect(container.querySelector('.markdown-chart-title')).toBeNull();
    expect(rendered[0]?.title).toMatchObject({ text: 'No card title' });
    expect(rendered[1]?.title).toMatchObject({ text: 'Direct title' });
    directHandle?.dispose();
    controller.dispose();
  });

  it('omits a placeholder when an inline chart has no title', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const container = document.createElement('div');
    const controller = new ChartController(registry);

    await controller.render(container, {
      language: 'markdown-chart',
      source: canonical(
        { series: [] },
        { kind: 'inline', dimensions: ['name'], source: [['A']] },
      ),
    });

    expect(container.classList.contains('markdown-chart-card')).toBe(true);
    expect(container.querySelector('.markdown-chart-title')).toBeNull();
    expect(rendered).not.toHaveProperty('title');
    controller.dispose();
  });

  it('removes only the first non-empty externalized title array entry', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const renderer = createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    });
    const mount = vi.spyOn(renderer, 'mount');
    const registry = new ChartRendererRegistry().register(renderer);
    const controller = new ChartController(registry);
    const container = document.createElement('div');
    const option = {
      title: [
        { text: '   ', left: 'left' },
        { text: 'Primary title', top: 8 },
        { text: 'Secondary title', right: 0 },
      ],
      series: [],
    };

    await controller.render(container, {
      language: 'markdown-chart',
      source: canonical(
        option,
        { kind: 'inline', dimensions: ['name'], source: [['A']] },
      ),
    });

    const mountedParsed = mount.mock.calls[0]?.[1] as ParsedEChartsSpec | undefined;
    expect(container.querySelector('.markdown-chart-title')?.textContent).toBe('Primary title');
    expect(rendered?.title).toMatchObject([
      { text: '   ', left: 'left' },
      { text: 'Secondary title', right: 0 },
    ]);
    expect(mountedParsed?.option).toEqual(option);
    controller.dispose();
  });

  it('keeps subtext while removing an externalized main title from the cloned option', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const renderer = createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    });
    const option = {
      title: [
        { text: 'Primary title', subtext: 'Subtitle', top: 8 },
        { text: 'Secondary title', right: 0 },
      ],
      series: [],
    };
    const parsed = await renderer.parse(option, {
      language: 'markdown-chart',
      rendererId: 'echarts',
      data: undefined,
    });

    const handle = await renderer.mount(document.createElement('div'), parsed, {
      signal: new AbortController().signal,
      theme: undefined,
      externalizedTitle: 'Primary title',
    });

    expect(rendered?.title).toMatchObject([
      { subtext: 'Subtitle', top: 8 },
      { text: 'Secondary title', right: 0 },
    ]);
    expect(parsed.option).toEqual(option);
    handle?.dispose();
  });

  it.each([
    ['unknown envelope field', { version: 1, data: { kind: 'inline', dimensions: ['x'], source: [[1]] }, option: {}, extra: true }],
    ['unknown inline field', { version: 1, data: { kind: 'inline', dimensions: ['x'], source: [[1]], extra: true }, option: {} }],
    ['unknown ref field', { version: 1, data: { kind: 'ref', ref: 'a.csv', format: 'csv', dimensions: ['x'], extra: true }, option: {} }],
    ['invalid dimension', { version: 1, data: { kind: 'inline', dimensions: ['not stable'], source: [[1]] }, option: {} }],
    ['duplicate dimension', { version: 1, data: { kind: 'inline', dimensions: ['x', 'x'], source: [[1, 2]] }, option: {} }],
    ['object row', { version: 1, data: { kind: 'inline', dimensions: ['x'], source: [{ x: 1 }] }, option: {} }],
    ['uneven row', { version: 1, data: { kind: 'inline', dimensions: ['x', 'y'], source: [[1]] }, option: {} }],
    ['missing ref format', { version: 1, data: { kind: 'ref', ref: 'a.csv', dimensions: ['x'] }, option: {} }],
    ['missing ref dimensions', { version: 1, data: { kind: 'ref', ref: 'a.csv', format: 'csv' }, option: {} }],
  ])('rejects compact schema violation: %s', async (_label, body) => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    await expect(registry.prepare('echarts-fulldata', JSON.stringify(body)))
      .rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('rejects unsupported compact versions and data/option.dataset conflicts', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    await expect(registry.prepare('echarts-fulldata', JSON.stringify({
      version: 2,
      data: { kind: 'inline', dimensions: ['x'], source: [[1]] },
      option: {},
    }))).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    await expect(registry.prepare('echarts-fulldata', compact(
      { dataset: { source: [] }, series: [] },
      { kind: 'inline', dimensions: ['x'], source: [[1]] },
    ))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
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

  it('reserves a stable top region for the real 30-day trend option', () => {
    const input = thirtyDayTrendOption();
    const original = structuredClone(input);

    const styled = applyEChartsDefaultStyle(input);

    expect(styled.legend).toMatchObject({ top: '10%' });
    expect(styled.legend).not.toHaveProperty('bottom');
    expect(styled.grid).toMatchObject({ top: 114, bottom: 3, containLabel: true });
    expect(styled.xAxis).toMatchObject({
      data: THIRTY_DAY_DATES,
      axisLabel: { rotate: 45, hideOverlap: true },
    });
    for (const height of [360, 640, 740]) {
      expect((styled.grid as Record<string, JsonValue>).top)
        .toBeGreaterThanOrEqual(height * 0.1 + 24 + 16);
    }
    expect(input).toEqual(original);
  });

  it.each([
    [0, 40],
    ['top', 40],
    [74, 114],
    [75, 24],
    [-1, 24],
    ['0%', 114],
    ['1%', 114],
    ['10%', 114],
    ['10.1%', 24],
    ['middle', 24],
    ['bottom', 24],
    ['auto', 24],
  ] as const)('classifies legend top=%s with grid.top=%s', (top, expectedGridTop) => {
    const styled = applyEChartsDefaultStyle({ legend: { top }, series: [] });

    expect(styled.legend).toMatchObject({ top });
    expect(styled.legend).not.toHaveProperty('bottom');
    expect(styled.grid).toMatchObject({ top: expectedGridTop });
  });

  it('preserves explicit anchors and computes title, legend, and grid arrays independently', () => {
    const styled = applyEChartsDefaultStyle({
      title: [
        { text: 'Default top title' },
        { text: 'Hidden title', show: false, top: '10%' },
        { text: 'Bottom title', bottom: 0 },
        { subtext: 'Top subtitle', top: 74 },
      ],
      legend: [
        { top: 0 },
        { bottom: 12 },
        { top: '10%', show: false },
        null,
      ],
      grid: [
        { right: 10 },
        { top: 9, bottom: 7 },
      ],
      series: [],
    });

    expect(styled.legend).toMatchObject([
      { top: 0 },
      { bottom: 12 },
      { top: '10%', show: false },
      null,
    ]);
    expect((styled.legend as JsonValue[])[0]).not.toHaveProperty('bottom');
    expect((styled.legend as JsonValue[])[1]).not.toHaveProperty('top');
    expect(styled.grid).toMatchObject([
      { top: 114, right: 10, bottom: 48, containLabel: true },
      { top: 9, bottom: 7, containLabel: true },
    ]);

    const explicitBoth = applyEChartsDefaultStyle({
      title: { text: 'Native title' },
      legend: { top: '10%', bottom: 6 },
      grid: { top: '20%', left: 7 },
      series: [],
    });
    expect(explicitBoth.legend).toMatchObject({ top: '10%', bottom: 6 });
    expect(explicitBoth.grid).toMatchObject({ top: '20%', left: 7 });

    expect(applyEChartsDefaultStyle({
      title: { text: 'Native title' },
      legend: { show: false, top: '10%' },
      series: [],
    }).grid).toMatchObject({ top: 40 });
    expect(applyEChartsDefaultStyle({
      title: { text: 'Bottom title', bottom: 0 },
      legend: { bottom: 4 },
      series: [],
    }).grid).toMatchObject({ top: 24 });
  });

  it('captures the final externalized-title layout through ChartController inline data', async () => {
    const rendered: Array<Record<string, JsonValue>> = [];
    const fake = fakeRuntime((option) => { rendered.push(option); });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));

    for (const height of [360, 640, 740]) {
      const container = document.createElement('div');
      container.style.height = `${height}px`;
      const controller = new ChartController(registry);
      await controller.render(container, {
        language: 'markdown-chart',
        source: canonical(thirtyDayTrendOption(), thirtyDayTrendData()),
      });

      const finalOption = rendered.at(-1);
      expect(container.querySelector('.markdown-chart-title')?.textContent)
        .toBe('最近30天各品类日销售额趋势');
      expect(container.querySelectorAll('.markdown-chart-title')).toHaveLength(1);
      expect(finalOption).not.toHaveProperty('title');
      expect(finalOption?.legend).toMatchObject({ top: '10%' });
      expect(finalOption?.legend).not.toHaveProperty('bottom');
      expect(finalOption?.grid).toMatchObject({ top: 114, bottom: 3, containLabel: true });
      expect(finalOption?.dataset).toMatchObject({
        dimensions: ['date', 'furniture', 'office', 'technology'],
      });
      expect((finalOption?.dataset as Record<string, JsonValue>).source).toHaveLength(30);
      controller.dispose();
    }
    expect(fake.dispose).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['light', {
      palette: LIGHT_SERIES_PALETTE,
      titleText: '#343434',
      subtext: '#aaaaaa',
      legendText: '#555555',
      axisLine: '#5d666f',
      valueAxisLine: '#6E7079',
      axisLabel: '#838d95',
      splitLine: '#e0e6f1',
      splitArea: ['rgba(250,250,250,0.2)', 'rgba(210,219,238,0.2)'],
      seriesBorder: '#ffffff',
      pointer: '#7c8a96',
      tooltipBg: '#ffffff',
    }],
    ['dark', {
      palette: DARK_SERIES_PALETTE,
      titleText: '#e0e2e8',
      subtext: '#8a8d93',
      legendText: '#c8cad0',
      axisLine: '#555a63',
      valueAxisLine: '#555a63',
      axisLabel: '#9da1a8',
      splitLine: '#3a3e47',
      splitArea: ['rgba(60,60,70,0.2)', 'rgba(80,80,90,0.2)'],
      seriesBorder: '#2a2d35',
      pointer: '#6a707a',
      tooltipBg: 'rgba(30, 32, 40, 0.95)',
    }],
  ] as const)('maps the %s ADA design-system theme without mutating input', (theme, tokens) => {
    const input: Record<string, JsonValue> = {
      title: { text: 'Title', subtext: 'Subtitle' },
      legend: {},
      tooltip: {},
      xAxis: {},
      yAxis: {},
      series: [{ type: 'line' }, { type: 'pie' }],
    };
    const original = JSON.parse(JSON.stringify(input)) as Record<string, JsonValue>;

    const styled = applyEChartsDefaultStyle(input, theme);

    expect(styled.color).toEqual(tokens.palette);
    expect(styled).toMatchObject({
      title: {
        textStyle: { color: tokens.titleText },
        subtextStyle: { color: tokens.subtext },
      },
      legend: {
        textStyle: { color: tokens.legendText },
        pageTextStyle: { color: tokens.legendText },
      },
      tooltip: {
        backgroundColor: tokens.tooltipBg,
        borderColor: tokens.splitLine,
        textStyle: { color: tokens.titleText },
        axisPointer: {
          lineStyle: { color: tokens.pointer },
          crossStyle: { color: tokens.pointer },
        },
      },
      xAxis: {
        axisLine: { lineStyle: { color: tokens.axisLine } },
        axisTick: { lineStyle: { color: tokens.axisLine } },
        axisLabel: { color: tokens.axisLabel },
        splitLine: { lineStyle: { color: tokens.splitLine } },
        splitArea: { areaStyle: { color: tokens.splitArea } },
      },
      yAxis: {
        axisLine: { lineStyle: { color: tokens.valueAxisLine } },
        axisTick: { lineStyle: { color: tokens.valueAxisLine } },
        axisLabel: { color: tokens.axisLabel },
        splitLine: { lineStyle: { color: tokens.splitLine } },
        splitArea: { areaStyle: { color: tokens.splitArea } },
      },
      series: [
        { emphasis: { itemStyle: { borderColor: tokens.seriesBorder } } },
        {
          itemStyle: { borderColor: tokens.seriesBorder },
          emphasis: { itemStyle: { borderColor: tokens.seriesBorder } },
        },
      ],
    });
    expect(input).toEqual(original);
  });

  it('preserves explicit design-system style overrides', () => {
    const input: Record<string, JsonValue> = {
      title: {
        text: 'Title',
        subtext: 'Subtitle',
        textStyle: { color: '#111111' },
        subtextStyle: { color: '#222222' },
      },
      legend: { textStyle: { color: '#333333' } },
      tooltip: {
        backgroundColor: '#444444',
        borderColor: '#555555',
        textStyle: { color: '#666666' },
        axisPointer: {
          lineStyle: { color: '#777777' },
          crossStyle: { color: '#888888' },
        },
      },
      xAxis: {
        axisLine: { lineStyle: { color: '#999999' } },
        axisLabel: { color: '#aaaaaa' },
        splitLine: { lineStyle: { color: '#bbbbbb' } },
        splitArea: { areaStyle: { color: ['#cccccc', '#dddddd'] } },
      },
      yAxis: { axisLine: { lineStyle: { color: '#eeeeee' } } },
      series: [{
        type: 'pie',
        itemStyle: { borderColor: '#121212' },
        emphasis: { itemStyle: { borderColor: '#232323' } },
      }],
    };

    expect(applyEChartsDefaultStyle(input, 'dark')).toMatchObject(input);
  });

  it('applies shared design-system light defaults while preserving explicit values', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));

    await new ChartController(registry).render(document.createElement('div'), {
      language: 'markdown-chart',
      source: canonical({
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
    expect(rendered?.color).toEqual(LIGHT_SERIES_PALETTE);
  });

  it('supports dark defaults and an explicit default-style opt-out', async () => {
    const rendered: Array<Record<string, JsonValue>> = [];
    const fake = fakeRuntime((option) => { rendered.push(option); });
    const styledRegistry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    await new ChartController(styledRegistry).render(document.createElement('div'), {
      language: 'markdown-chart',
      source: canonical({ series: [{ type: 'line' }] }),
      theme: 'dark',
    });

    const plainRegistry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
      defaultStyle: false,
    }));
    await new ChartController(plainRegistry).render(document.createElement('div'), {
      language: 'markdown-chart',
      source: canonical({ series: [{ type: 'line' }] }),
    });

    expect(rendered[0]).toMatchObject({
      backgroundColor: '#0d0d0d',
      textStyle: { color: '#f4f7ff' },
      series: [{ type: 'line', symbol: 'circle', symbolSize: 4 }],
    });
    expect(rendered[0]?.color).toEqual(DARK_SERIES_PALETTE);
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
    const controller = new ChartController(registry);
    const container = document.createElement('div');

    await controller.render(container, {
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
    const showData = container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    expect(showData).not.toBeNull();
    showData?.click();
    const dataView = container.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.querySelector('tbody')?.textContent).toContain('A10');
    expect(dataView?.querySelector('tbody')?.textContent).toContain('B20');
    controller.dispose();
  });

  it('owns CSV parsing and sandbox conversion for the ArtifactContent resolver', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const resolveLegacyArtifactContent = vi.fn(async () => (
      'category,value,active,empty,biz_date\nA,10,true,,20260622\nB,20,false,,20260701\n'
    ));
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveLegacyArtifactContent,
      resizeObserver: false,
    }));
    const controller = new ChartController(registry);
    const container = document.createElement('div');
    const render = controller.render(container, {
      language: 'echarts-chatbi_query_42-0',
      source: 'var option = { series: [{ type: "bar" }] };\n//#end',
    });
    await answerLegacySandbox({
      xAxis: { type: 'category' },
      yAxis: {},
      series: [{ type: 'bar' }],
    });
    await render;

    expect(resolveLegacyArtifactContent).toHaveBeenCalledWith({
      language: 'echarts-chatbi_query_42-0',
      jobId: 'chatbi_query_42',
      index: 0,
      signal: expect.any(AbortSignal),
    });
    expect(rendered?.dataset).toEqual({
      dimensions: ['category', 'value', 'active', 'empty', 'biz_date'],
      source: [
        { category: 'A', value: '10', active: 'true', empty: '', biz_date: '20260622' },
        { category: 'B', value: '20', active: 'false', empty: '', biz_date: '20260701' },
      ],
    });
    container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]')?.click();
    const dataView = container.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.querySelector('tbody')?.textContent).toContain('A10true""20260622');
    controller.dispose();
  });

  it('resolves a case-sensitive sandbox file path through the host callback', async () => {
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const resolveLegacySandboxFileContent = vi.fn(async () => 'name,value\nA,10\n');
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveLegacySandboxFileContent,
      resizeObserver: false,
    }));
    const controller = new ChartController(registry);
    const render = controller.render(document.createElement('div'), {
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      source: 'var option = { series: [{ type: "bar" }] };\n//#end',
    });
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await render;

    expect(resolveLegacySandboxFileContent).toHaveBeenCalledWith({
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      filePath: 'App/CSV/Foo.csv',
      signal: expect.any(AbortSignal),
    });
    expect(rendered?.dataset).toEqual({
      dimensions: ['name', 'value'],
      source: [{ name: 'A', value: '10' }],
    });
    controller.dispose();
  });

  it('rejects ambiguous legacy resolver configuration immediately', () => {
    expect(() => createEChartsRenderer({
      resolveLegacyArtifactContent: async () => 'a\n1\n',
      resolveLegacyEChartQuery: async () => ({
        data: { kind: 'inline', source: [] },
        spec: { series: [] },
      }),
    })).toThrow(/either resolveLegacyArtifactContent or resolveLegacyEChartQuery/);
  });

  it('materializes legacy content through the public sandbox client binding', async () => {
    interface HostFile extends LegacySandboxFile {
      readonly content: string;
    }
    const selected: HostFile = {
      fileName: 'chatbi_query_42.csv',
      filePath: '/sandbox/chatbi_query_42.csv',
      originalFilePath: '',
      fileType: 'text/csv',
      content: 'name,value\nA,10\n',
    };
    const transport: LegacySandboxTransport<HostFile> = {
      listFiles: vi.fn(async () => [selected]),
      readFile: vi.fn(async ({ file }) => file.content),
      classifyError: vi.fn<LegacySandboxTransport<HostFile>['classifyError']>(() => 'fatal'),
    };
    const legacySandbox = createLegacySandboxClient({ transport }).bind({
      sessionId: 'session-1',
      requestId: 'request-1',
      phase: 'final',
      cacheScopeKey: 'tenant-1:user-1',
    });
    let rendered: Record<string, JsonValue> | undefined;
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      legacySandbox,
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const render = new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_42-0',
      source: 'var option = { series: [{ type: "bar" }] };',
    });

    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await render;
    expect(transport.listFiles).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
    }));
    expect(vi.mocked(transport.listFiles).mock.calls[0]?.[0]).not.toHaveProperty('requestId');
    expect(rendered?.dataset).toEqual({
      dimensions: ['name', 'value'],
      source: [{ name: 'A', value: '10' }],
    });
  });

  it.each([
    ['raw artifact', {
      resolveLegacyArtifactContent: async () => 'a\n1\n',
    }],
    ['sandbox file', {
      resolveLegacySandboxFileContent: async () => 'a\n1\n',
    }],
    ['advanced query', {
      resolveLegacyEChartQuery: async () => ({
        data: { kind: 'inline' as const, source: [] },
        spec: { series: [] },
      }),
    }],
  ] satisfies readonly [string, Partial<CreateEChartsRendererOptions>][]) (
    'rejects legacySandbox combined with the deprecated %s callback',
    (_label, deprecatedOption) => {
      const legacySandbox: LegacySandboxBinding = {
        resolveLegacyArtifactContent: async () => 'a\n1\n',
        resolveLegacySandboxFileContent: async () => 'a\n1\n',
        shouldDefer: () => false,
      };
      expect(() => createEChartsRenderer({ legacySandbox, ...deprecatedOption }))
        .toThrowError(expect.objectContaining({
          name: 'LegacySandboxError',
          code: 'LEGACY_SANDBOX_CONFIGURATION_CONFLICT',
        }));
    },
  );

  it('keeps the existing old-callback combination matrix unchanged', () => {
    const resolveLegacySandboxFileContent = async (): Promise<string> => 'a\n1\n';
    expect(() => createEChartsRenderer({
      resolveLegacyArtifactContent: async () => 'a\n1\n',
      resolveLegacySandboxFileContent,
    })).not.toThrow();
    expect(() => createEChartsRenderer({
      resolveLegacyEChartQuery: async () => ({
        data: { kind: 'inline', source: [] },
        spec: { series: [] },
      }),
      resolveLegacySandboxFileContent,
    })).not.toThrow();
  });

  it.each([
    ['query', 'echarts-chatbi_query_42-0'],
    ['sandbox file', 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv'],
  ] as const)('preserves a public LegacySandboxError through the %s renderer path', async (
    _label,
    language,
  ) => {
    const publicError = new LegacySandboxError(
      'LEGACY_SANDBOX_FATAL',
      'public legacy failure',
      { cause: new Error('transport failure') },
    );
    const legacySandbox: LegacySandboxBinding = {
      resolveLegacyArtifactContent: async () => { throw publicError; },
      resolveLegacySandboxFileContent: async () => { throw publicError; },
      shouldDefer: () => false,
    };
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      legacySandbox,
      loadECharts,
    }));

    const error = await new ChartController(registry).render(document.createElement('div'), {
      language,
      source: 'var option = {};',
    }).catch((cause: unknown) => cause);
    expect(error).toBe(publicError);
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it.each([
    ['raw artifact', 'echarts-chatbi_query_42-0', (error: LegacySandboxError) => ({
      resolveLegacyArtifactContent: async () => { throw error; },
    })],
    ['sandbox file', 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv', (
      error: LegacySandboxError,
    ) => ({
      resolveLegacySandboxFileContent: async () => { throw error; },
    })],
    ['advanced query', 'echarts-chatbi_query_42-0', (error: LegacySandboxError) => ({
      resolveLegacyEChartQuery: async () => { throw error; },
    })],
  ] as const)('keeps a LegacySandboxError from the old %s callback wrapped', async (
    _label,
    language,
    option,
  ) => {
    const original = new LegacySandboxError('LEGACY_SANDBOX_FATAL', 'old callback failure');
    const registry = new ChartRendererRegistry().register(createEChartsRenderer(option(original)));

    const error = await new ChartController(registry).render(document.createElement('div'), {
      language,
      source: 'var option = {};',
    }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(MarkdownChartError);
    expect(error).toMatchObject({ code: 'REF_RESOLUTION_FAILED', cause: original });
  });

  it.each(['delay', 'list', 'read'] as const)(
    'treats a public binding abort during %s as neutral renderer cancellation',
    async (stage) => {
      const selected: LegacySandboxFile = {
        fileName: 'chatbi_query_42.csv',
        filePath: 'chatbi_query_42.csv',
        originalFilePath: '',
        fileType: 'csv',
      };
      let listCalls = 0;
      const listFiles = vi.fn<LegacySandboxTransport['listFiles']>(({ signal }) => {
        listCalls += 1;
        if (stage === 'delay') return Promise.resolve([]);
        if (stage === 'read') return Promise.resolve([selected]);
        return new Promise<readonly LegacySandboxFile[]>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      });
      const readFile = vi.fn<LegacySandboxTransport['readFile']>(({ signal }) => (
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
      ));
      const transport: LegacySandboxTransport = {
        listFiles,
        readFile,
        classifyError: vi.fn<LegacySandboxTransport['classifyError']>(() => 'fatal'),
      };
      const legacySandbox = createLegacySandboxClient({ transport }).bind({
        sessionId: 'session-1',
        requestId: 'request-1',
        phase: 'final',
        cacheScopeKey: 'tenant-1:user-1',
      });
      const loadECharts = vi.fn();
      const registry = new ChartRendererRegistry().register(createEChartsRenderer({
        legacySandbox,
        loadECharts,
      }));
      const controller = new ChartController(registry);
      const container = document.createElement('div');
      const render = controller.render(container, {
        language: 'echarts-chatbi_query_42-0',
        source: 'var option = {};',
      });
      if (stage === 'read') {
        await vi.waitFor(() => expect(transport.readFile).toHaveBeenCalledOnce());
      } else {
        await vi.waitFor(() => expect(transport.listFiles).toHaveBeenCalledOnce());
      }

      await controller.render(container, {
        language: 'echarts-chatbi_query_42-0',
        source: 'var option = {};',
        streaming: true,
      });
      await render;
      expect(loadECharts).not.toHaveBeenCalled();
      expect(container.childElementCount).toBe(0);
      expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).toBeNull();
      expect(listCalls).toBe(1);
    },
  );

  it('revalidates sandbox-produced ArtifactContent options before loading ECharts', async () => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts,
      resolveLegacyArtifactContent: async () => 'name,value\nA,10\n',
    }));
    const render = new ChartController(registry).render(document.createElement('div'), {
      language: 'echarts-chatbi_query_42-0',
      source: 'var option = {};',
    });
    await answerLegacySandbox({
      tooltip: { formatter: { unsafe: true } },
      series: [],
    });
    await expect(render).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it('aborts an in-flight temporary ChatBI resolver before UI or runtime creation', async () => {
    let finishResolve: ((value: ResolvedLegacyEChartQuery) => void) | undefined;
    let resolverSignal: AbortSignal | undefined;
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts,
      resolveLegacyEChartQuery: ({ signal }) => {
        resolverSignal = signal;
        return new Promise((resolve) => {
          finishResolve = resolve;
        });
      },
    }));
    const controller = new ChartController(registry);
    const container = document.createElement('div');
    const render = controller.render(container, {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
    });
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));

    await controller.render(container, {
      language: 'echarts-chatbi_query_8660210443288600709-0',
      source: 'var option = {};',
      streaming: true,
    });
    expect(resolverSignal?.aborted).toBe(true);
    finishResolve?.({
      data: { kind: 'inline', source: [] },
      spec: { series: [] },
    });
    await render;
    expect(loadECharts).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
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
        spec: { tooltip: { formatter: { unsafe: true } as unknown as JsonValue }, series: [] },
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
      source: [['Jan', 100]],
    }));
    const fake = fakeRuntime((option) => { rendered = option; });
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resolveDataRef: resolver,
      validateDataRef: (ref) => ref.startsWith('artifact://chart-data/'),
      resizeObserver: false,
    }));

    const element = document.createElement('div');
    await new ChartController(registry).render(element, {
      language: 'markdown-chart',
      source: canonical(
        { series: [{ type: 'line' }] },
        {
          kind: 'ref',
          ref: 'artifact://chart-data/sales-q1.csv',
          format: 'csv',
          dimensions: ['month', 'sales'],
        },
      ),
    });

    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith('artifact://chart-data/sales-q1.csv', expect.objectContaining({
      format: 'csv',
      dimensions: ['month', 'sales'],
      signal: expect.any(AbortSignal),
    }));
    expect(rendered?.dataset).toEqual({
      dimensions: ['month', 'sales'],
      source: [['Jan', 100]],
    });
    const chartView = element.querySelector<HTMLElement>('[data-markdown-chart-chart-view]');
    const dataView = element.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    expect(chartView).not.toBeNull();
    expect(dataView?.hidden).toBe(true);
    element.querySelector<HTMLButtonElement>('button[aria-label="Show data"]')?.click();
    expect(chartView?.hidden).toBe(true);
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.textContent).toContain('Jan');
    expect(dataView?.textContent).toContain('100');
  });

  it('aborts an in-flight data-ref resolver before UI or runtime creation', async () => {
    let finishResolve: ((value: ResolvedDataset) => void) | undefined;
    let resolverSignal: AbortSignal | undefined;
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts,
      resolveDataRef: (_ref, { signal }) => {
        resolverSignal = signal;
        return new Promise((resolve) => {
          finishResolve = resolve;
        });
      },
    }));
    const controller = new ChartController(registry);
    const element = document.createElement('div');
    const render = controller.render(element, {
      language: 'markdown-chart',
      source: JSON.stringify({
        version: 1,
        renderer: 'echarts',
        data: { kind: 'ref', ref: 'artifact://chart-data/sales-q1.csv' },
        spec: { series: [{ type: 'line' }] },
      }),
    });
    await vi.waitFor(() => expect(finishResolve).toBeTypeOf('function'));

    await controller.render(element, {
      language: 'echarts',
      source: '{',
      streaming: true,
    });
    expect(resolverSignal?.aborted).toBe(true);
    finishResolve?.({ source: [['Jan', 100]] });
    await render;
    expect(loadECharts).not.toHaveBeenCalled();
    expect(element.childElementCount).toBe(0);
  });

  it('fails closed when a ref resolver is missing', async () => {
    const fake = fakeRuntime(() => undefined);
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => fake.runtime,
      resizeObserver: false,
    }));
    const promise = new ChartController(registry).render(document.createElement('div'), {
      language: 'markdown-chart',
      source: canonical(
        { series: [] },
        { kind: 'ref', ref: 'app://datasets/sales' },
      ),
    });
    await expect(promise).rejects.toMatchObject({
      code: 'REF_RESOLVER_MISSING',
    });
  });

  it('rejects URL-bearing options before loading ECharts', async () => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({ loadECharts }));
    await expect(registry.prepare('markdown-chart', canonical({
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
    await expect(registry.prepare('markdown-chart', canonical({
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
    await expect(registry.prepare('markdown-chart', canonical({
      title: { text: value },
      series: [],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
  });

  it('does not mistake dataZoom or visualMap for URL-bearing keys', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('markdown-chart', canonical({
      dataZoom: [{ type: 'inside' }],
      visualMap: { min: 0, max: 100 },
      series: [],
    }))).resolves.toMatchObject({ rendererId: 'echarts' });
  });

  it.each([
    ['canonical', 'markdown-chart', canonical({ tooltip: { formatter: '{b}: {@value}%' }, series: [] })],
    ['compact', 'echarts-fulldata', compact(
      { series: [{ type: 'bar', label: { formatter: '{@conversionRate}%\n{b}' } }] },
      { kind: 'inline', dimensions: ['name', 'conversionRate'], source: [['A', 10]] },
    )],
  ])('accepts safe string formatter templates through %s input', async (_label, language, source) => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    await expect(registry.prepare(language, source)).resolves.toMatchObject({ rendererId: 'echarts' });
  });

  it.each([
    ['non-string', { unsafe: true }],
    ['URL', 'https://example.test/value'],
    ['HTML', '<img src=x>'],
    ['entity', '&lt;script&gt;'],
    ['control', 'bad\u0001value'],
  ])('rejects unsafe formatter %s through canonical and compact input', async (_label, formatter) => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer());
    const option = { tooltip: { formatter: formatter as unknown as JsonValue }, series: [] };
    await expect(registry.prepare('markdown-chart', canonical(option)))
      .rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    await expect(registry.prepare('echarts-fulldata', compact(
      option,
      { kind: 'inline', dimensions: ['x'], source: [[1]] },
    ))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
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
    ['toolbox data view surface', { toolbox: { feature: { dataView: {} } }, series: [] }],
    ['custom renderer surface', { series: [{ type: 'custom', renderItem: 'return value' }] }],
    ['graphic surface', { graphic: [{ type: 'rect', shape: { width: 1, height: 1 } }], series: [] }],
    ['image surface', { series: [{ type: 'bar', symbol: 'image://https://example.test/a.png' }] }],
    ['URL surface', { title: { text: 'chart', link: 'https://example.test/' }, series: [] }],
    ['HTML surface', { title: { text: '<img src=x onerror=alert(1)>' }, series: [] }],
  ])('rejects unsafe %s', async (_label, option) => {
    const loadECharts = vi.fn();
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({ loadECharts }));
    await expect(registry.prepare('markdown-chart', canonical(option)))
      .rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    expect(loadECharts).not.toHaveBeenCalled();
  });

  it('rejects unknown top-level ECharts surfaces', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('markdown-chart', canonical({
      futureExecutableSurface: { enabled: true },
      series: [],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
  });

  it('rejects custom series and dataset conflicts', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('markdown-chart', canonical({
      series: [{ type: 'custom' }],
    }))).rejects.toMatchObject({ code: 'UNSAFE_SPEC' });
    await expect(registry.prepare('markdown-chart', canonical({
      data: { kind: 'inline', source: [] },
      option: { dataset: { source: [] } },
    }))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('rejects the removed renderer-specific envelope inside canonical spec', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
    }));
    await expect(registry.prepare('markdown-chart', canonical({
      version: 1,
      option: { series: [] },
    }))).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('applies dataset limits to canonical ECharts specs', async () => {
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => { throw new Error('must not load'); },
      limits: { maxRows: 1 },
    }));
    await expect(registry.prepare('markdown-chart', canonical({
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
      language: 'markdown-chart',
      source: canonical({ series: [] }),
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
        language: 'markdown-chart',
        source: canonical({ series: [] }),
      })).rejects.toMatchObject({ code: 'RENDER_FAILED' });
      expect(disconnect).toHaveBeenCalledOnce();
      expect(fake.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
