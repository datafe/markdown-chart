// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  type ChartReferenceActions,
} from '@datafe-open/markdown-chart';
import { createKpiRenderer, parseKpiSpec } from '../src/index';

function envelope(data: unknown, spec: unknown): string {
  return JSON.stringify({ version: 1, renderer: 'kpi', data, spec });
}

async function render(
  source: string,
  options: Parameters<typeof createKpiRenderer>[0] = {},
  referenceActions?: ChartReferenceActions,
): Promise<{ container: HTMLDivElement; controller: ChartController }> {
  const registry = new ChartRendererRegistry().register(createKpiRenderer(options));
  const controller = new ChartController(registry);
  const container = document.createElement('div');
  await controller.render(container, {
    language: 'markdown-chart',
    source,
    ...(referenceActions ? { referenceActions } : {}),
  });
  return { container, controller };
}

async function renderFailure(
  source: string,
  options: Parameters<typeof createKpiRenderer>[0] = {},
  expectedCode = 'SCHEMA_INVALID',
): Promise<void> {
  const registry = new ChartRendererRegistry().register(createKpiRenderer(options));
  const controller = new ChartController(registry);
  const container = document.createElement('div');
  await expect(controller.render(container, { language: 'markdown-chart', source })).rejects
    .toMatchObject({ code: expectedCode });
}

const wideData = {
  kind: 'inline',
  dimensions: ['day', 'revenue', 'conversion', 'inventory', 'status', 'tone'],
  source: [
    ['2026-08-29', 15_200_000, 0.32, 31, '安全', 'positive'],
    ['2026-08-30', 16_100_000, 0.36, 28, '关注', 'warning'],
    ['2026-08-31', 17_000_000, 0.38, 25, '关注', 'warning'],
    ['2026-09-01', 18_000_000, 0.4, 23, '低于安全水位', 'negative'],
  ],
};

const mixedSpec = {
  timeField: 'day',
  items: [
    {
      id: 'revenue',
      title: '预计增量营收',
      value: {
        field: 'revenue',
        reduce: 'lastNonNull',
        format: { style: 'currency', currency: 'CNY', notation: 'compact', maximumFractionDigits: 1 },
      },
      trend: {
        type: 'area',
        compare: { lag: 1, mode: 'relative', label: '较昨日', polarity: 'higher-is-better' },
      },
      references: [{ ref: 'opaque:revenue', label: '营收口径' }],
    },
    {
      id: 'conversion',
      title: '未满足需求',
      value: { field: 'conversion', format: { style: 'percent', maximumFractionDigits: 0 } },
      trend: {
        type: 'line',
        compare: { lag: 1, mode: 'absolute', label: '日变化', polarity: 'lower-is-better' },
        yScale: { includeZero: true },
      },
    },
    {
      id: 'inventory',
      title: '门店库存',
      value: { field: 'inventory', format: { style: 'decimal', suffix: '/48' } },
      status: { text: { field: 'status' }, tone: { field: 'tone' } },
      references: [{ ref: 'opaque:inventory', label: '库存说明' }],
    },
  ],
};

describe('KPI data/config contract', () => {
  it('renders mixed area, line, and no-trend cards from one wide inline dataset', async () => {
    const { container } = await render(envelope(wideData, mixedSpec));
    const values = [...container.querySelectorAll<HTMLElement>('[data-markdown-chart-kpi-value]')]
      .map((element) => element.textContent);

    expect(values).toEqual(['¥18M', '40%', '23/48']);
    expect(container.querySelectorAll('[data-markdown-chart-kpi-trend="area"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-markdown-chart-kpi-trend="line"]')).toHaveLength(1);
    expect(container.querySelector('[data-markdown-chart-kpi-id="inventory"] svg')).toBeNull();
    expect(container.querySelector('[data-markdown-chart-kpi-id="inventory"] [data-markdown-chart-kpi-tone="negative"]')?.textContent)
      .toBe('低于安全水位');
    expect(container.querySelector('[data-markdown-chart-kpi-id="revenue"] .markdown-chart-kpi-compare')?.textContent)
      .toContain('较昨日');
  });

  it('uses one ref resolution for values, trend, compare, and the core Data view', async () => {
    const resolveDataRef = vi.fn(async () => ({
      dimensions: wideData.dimensions,
      source: wideData.source,
    }));
    const { container } = await render(
      envelope({ kind: 'ref', ref: 'dataset:weekly', format: 'json' }, mixedSpec),
      { resolveDataRef },
    );

    expect(resolveDataRef).toHaveBeenCalledOnce();
    expect(resolveDataRef).toHaveBeenCalledWith('dataset:weekly', expect.objectContaining({ format: 'json' }));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.markdown-chart-toggle button')];
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    expect(container.querySelector('.markdown-chart-data-view')?.textContent).toContain('2026-09-01');
    expect(container.querySelector('.markdown-chart-data-view')?.textContent).toContain('18000000');
    expect(resolveDataRef).toHaveBeenCalledOnce();
  });

  it('inherits declared ref dimensions when the resolver omits them', async () => {
    const { container } = await render(
      envelope({ kind: 'ref', ref: 'dataset:one', dimensions: ['name', 'value'] }, {
        items: [{ id: 'value', title: 'Value', value: { field: 'value' } }],
      }),
      { resolveDataRef: async () => ({ source: [['A', 42]] }) },
    );
    expect(container.querySelector('[data-markdown-chart-kpi-value]')?.textContent).toBe('42');
  });

  it('degrades a one-point trend to a plain KPI without failing the group', async () => {
    const { container } = await render(envelope(
      { kind: 'inline', source: [{ day: '2026-09-01', value: 7 }] },
      {
        timeField: 'day',
        items: [{ id: 'single', title: 'Single', value: { field: 'value' }, trend: { type: 'line' } }],
      },
    ));
    expect(container.querySelector('[data-markdown-chart-kpi-value]')?.textContent).toBe('7');
    expect(container.querySelector('.markdown-chart-kpi-trend')).toBeNull();
    expect(container.textContent).not.toContain('Chart unavailable');
  });

  it('maps identical positive deltas through opposite polarity semantics', async () => {
    const { container } = await render(envelope(
      { kind: 'inline', source: [{ t: 1, a: 10, b: 10 }, { t: 2, a: 12, b: 12 }] },
      {
        timeField: 't',
        items: [
          {
            id: 'higher', title: 'Higher', value: { field: 'a' },
            trend: { type: 'line', compare: { lag: 1, mode: 'absolute', polarity: 'higher-is-better' } },
          },
          {
            id: 'lower', title: 'Lower', value: { field: 'b' },
            trend: { type: 'line', compare: { lag: 1, mode: 'absolute', polarity: 'lower-is-better' } },
          },
        ],
      },
    ));
    expect(container.querySelector('[data-markdown-chart-kpi-id="higher"] .markdown-chart-kpi-compare')?.getAttribute('data-markdown-chart-kpi-tone'))
      .toBe('positive');
    expect(container.querySelector('[data-markdown-chart-kpi-id="lower"] .markdown-chart-kpi-compare')?.getAttribute('data-markdown-chart-kpi-tone'))
      .toBe('negative');
  });

  it('uses exact source-row lag and does not skip a null comparison row', async () => {
    const { container } = await render(envelope(
      { kind: 'inline', source: [{ t: 1, value: 10 }, { t: 2, value: null }, { t: 3, value: 15 }] },
      {
        timeField: 't',
        items: [{
          id: 'value', title: 'Value', value: { field: 'value' },
          trend: { type: 'line', compare: { lag: 1, mode: 'absolute', polarity: 'neutral' } },
        }],
      },
    ));
    expect(container.querySelector('.markdown-chart-kpi-sparkline')).not.toBeNull();
    expect(container.querySelector('.markdown-chart-kpi-compare')).toBeNull();
  });

  it('supports literal and field status bindings', async () => {
    const { container } = await render(envelope(
      { kind: 'inline', source: [{ value: 3, dynamicText: 'Ready', dynamicTone: 'positive' }] },
      {
        items: [
          { id: 'field', title: 'Field', value: { field: 'value' }, status: { text: { field: 'dynamicText' }, tone: { field: 'dynamicTone' } } },
          { id: 'literal', title: 'Literal', value: { field: 'value' }, status: { text: { literal: 'Stable' }, tone: { literal: 'neutral' } } },
        ],
      },
    ));
    expect([...container.querySelectorAll('.markdown-chart-kpi-status')].map((node) => node.textContent))
      .toEqual(['Ready', 'Stable']);
  });

  it('supports safe Intl unit formatting and explicit null display', async () => {
    const { container } = await render(envelope(
      { kind: 'inline', source: [{ distance: 5, missing: null }] },
      {
        items: [
          {
            id: 'distance',
            title: 'Distance',
            value: { field: 'distance', format: { style: 'unit', unit: 'meter', maximumFractionDigits: 0 } },
          },
          {
            id: 'missing',
            title: 'Missing',
            value: { field: 'missing', format: { style: 'decimal', nullDisplay: '暂无数据' } },
          },
        ],
      },
    ));
    expect([...container.querySelectorAll('[data-markdown-chart-kpi-value]')].map((node) => node.textContent))
      .toEqual(['5 m', '暂无数据']);
  });
});

describe('KPI validation and security boundaries', () => {
  it('rejects the removed literal-value schema and top-level item affixes', () => {
    expect(() => parseKpiSpec({ items: [{ id: 'old', title: 'Old', value: '40%' }] }))
      .toThrowError(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
    expect(() => parseKpiSpec({ items: [{ id: 'old', title: 'Old', value: { field: 'value' }, prefix: '¥' }] }))
      .toThrowError(expect.objectContaining({ code: 'SCHEMA_INVALID' }));
  });

  it('requires canonical data', async () => {
    await renderFailure(JSON.stringify({
      version: 1,
      renderer: 'kpi',
      spec: { items: [{ id: 'x', title: 'X', value: { field: 'x' } }] },
    }));
  });

  it('rejects missing fields, invalid Intl configurations, and nonnumeric trend columns', async () => {
    await renderFailure(envelope(
      { kind: 'inline', source: [{ present: 1 }] },
      { items: [{ id: 'x', title: 'X', value: { field: 'missing' } }] },
    ));

    expect(() => parseKpiSpec({
      items: [{ id: 'x', title: 'X', value: { field: 'x', format: { style: 'currency', currency: 'rmb' } } }],
    })).toThrowError(expect.objectContaining({ code: 'SCHEMA_INVALID' }));

    await renderFailure(envelope(
      { kind: 'inline', source: [{ t: 1, value: 'bad' }, { t: 2, value: 'worse' }] },
      { timeField: 't', items: [{ id: 'x', title: 'X', value: { field: 'value' }, trend: { type: 'line' } }] },
    ));
  });

  it('fails closed when a host rejects a data ref or no resolver is provided', async () => {
    const source = envelope(
      { kind: 'ref', ref: 'private:data' },
      { items: [{ id: 'x', title: 'X', value: { field: 'x' } }] },
    );
    await renderFailure(
      source,
      { validateDataRef: () => false, resolveDataRef: async () => ({ source: [] }) },
      'REF_REJECTED',
    );
    await renderFailure(source, {}, 'REF_RESOLVER_MISSING');
  });

  it('enforces the trend point limit without silently truncating', async () => {
    await renderFailure(envelope(
      { kind: 'inline', source: [{ t: 1, x: 1 }, { t: 2, x: 2 }, { t: 3, x: 3 }] },
      { timeField: 't', items: [{ id: 'x', title: 'X', value: { field: 'x' }, trend: { type: 'line' } }] },
    ), { limits: { maxTrendPoints: 2 } }, 'LIMIT_EXCEEDED');
  });
});

describe('KPI opaque references', () => {
  it('opens only host-approved references and rechecks approval on click', async () => {
    let allowed = true;
    const open = vi.fn();
    const actions: ChartReferenceActions = {
      canOpen: ({ reference }) => allowed && reference.ref === 'opaque:revenue',
      open,
    };
    const { container } = await render(envelope(wideData, mixedSpec), {}, actions);
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.markdown-chart-kpi-reference')];
    expect(buttons).toHaveLength(1);
    buttons[0]?.click();
    expect(open).toHaveBeenCalledWith({
      rendererId: 'kpi',
      reference: { ref: 'opaque:revenue', label: '营收口径' },
    });
    allowed = false;
    buttons[0]?.click();
    expect(open).toHaveBeenCalledOnce();
  });
});
