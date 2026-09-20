// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  DEFAULT_MARKDOWN_CHART_LABELS,
  ChartRendererRegistry,
  type ChartData,
} from '@datafe-open/markdown-chart';
import type { ColDef, GridApi, GridOptions, Theme } from 'ag-grid-community';
import {
  createTableDataViewProvider,
  createTableRenderer,
  parseTableSpec,
  serializeTableCsv,
  type TableGridRuntime,
} from '../src/index';

type Row = Record<string, string | number | boolean | null | undefined>;

function envelope(data: unknown, spec: unknown): string {
  return JSON.stringify({ version: 1, renderer: 'table', data, spec });
}

function fakeGridRuntime(displayedRows?: readonly Row[]): {
  runtime: TableGridRuntime;
  createGrid: ReturnType<typeof vi.fn>;
  setGridOption: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  sizeColumnsToFit: ReturnType<typeof vi.fn>;
  options: () => GridOptions<Row>;
} {
  let captured: GridOptions<Row> | undefined;
  const setGridOption = vi.fn();
  const destroy = vi.fn();
  const sizeColumnsToFit = vi.fn();
  const createGrid = vi.fn((_container: HTMLElement, options: GridOptions<Row>) => {
    captured = options;
    const rows = displayedRows ?? options.rowData ?? [];
    return {
      setGridOption,
      destroy,
      sizeColumnsToFit,
      getDisplayedRowCount: () => rows.length,
      forEachNodeAfterFilterAndSort: (callback: (node: { data?: Row }) => void) => {
        rows.forEach((data) => callback({ data }));
      },
    } as unknown as GridApi<Row>;
  });
  const themeQuartz = {
    withParams: vi.fn(() => ({} as Theme)),
  } as unknown as Theme;
  return {
    runtime: {
      createGrid: (container, options) => createGrid(container, options as GridOptions<Row>),
      themeQuartz,
    },
    createGrid,
    setGridOption,
    destroy,
    sizeColumnsToFit,
    options: () => captured as GridOptions<Row>,
  };
}

async function render(
  source: string,
  options: Parameters<typeof createTableRenderer>[0] = {},
): Promise<{ container: HTMLDivElement; controller: ChartController }> {
  const registry = new ChartRendererRegistry().register(createTableRenderer(options));
  const controller = new ChartController(registry);
  const container = document.createElement('div');
  await controller.render(container, { language: 'markdown-chart', source });
  return { container, controller };
}

describe('table renderer protocol', () => {
  it('parses bounded declarative columns and rejects executable or ambiguous config', () => {
    expect(parseTableSpec({})).toEqual({ height: 420 });
    expect(parseTableSpec({
      title: 'Regional performance',
      height: 480,
      columns: [
        { field: 'sales', type: 'number', format: { style: 'currency', currency: 'CNY' } },
        { id: 'trend', cell: { kind: 'sparkline', fields: ['apr', 'may'] } },
      ],
      initialSort: [{ field: 'sales', direction: 'desc' }],
    })).toMatchObject({
      title: 'Regional performance',
      height: 480,
      columns: [
        { field: 'sales', type: 'number' },
        { id: 'trend', cell: { kind: 'sparkline', fields: ['apr', 'may'], scale: 'column' } },
      ],
    });

    expect(() => parseTableSpec({ columns: [{ field: 'sales', formatter: 'alert(1)' }] }))
      .toThrow(/formatter is not allowed/);
    expect(() => parseTableSpec({ columns: [{ field: 'sales', id: 'same' }, { field: 'growth', id: 'same' }] }))
      .toThrow(/unique effective ids/);
    expect(() => parseTableSpec({ columns: [{ field: 'sales', format: { style: 'currency' } }] }))
      .toThrow(/currency must be/);
    expect(() => parseTableSpec({ columns: [{ id: 'trend', cell: { kind: 'sparkline', fields: ['apr'] } }] }))
      .toThrow(/2-50 fields/);
  });

  it('builds typed AG Grid columns and custom cells without expanded filters or export', async () => {
    const east: Row = {
      region: 'East', sales: 1_280_000, growth: 0.126, apr: 92, may: 105, jun: 128, note: '=SUM(A1:A2)',
    };
    const south: Row = {
      region: 'South', sales: 960_000, growth: -0.035, apr: 103, may: null, jun: 96, note: 'review',
    };
    const fake = fakeGridRuntime([south, east]);
    const downloadCsv = vi.fn();
    const { container, controller } = await render(envelope({
      kind: 'inline',
      source: [east, south],
    }, {
      title: 'Regional performance',
      columns: [
        { field: 'region', pinned: 'left' },
        { field: 'sales', type: 'number', format: { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 } },
        { field: 'growth', type: 'number', format: { style: 'percent', maximumFractionDigits: 1 }, cell: { kind: 'change', polarity: 'higher-is-better' } },
        { id: 'trend', title: 'Trend', cell: { kind: 'sparkline', fields: ['apr', 'may', 'jun'], labels: ['Apr', 'May', 'Jun'] } },
      ],
      initialSort: [{ field: 'sales', direction: 'desc' }],
    }), {
      loadGrid: () => fake.runtime,
      downloadCsv,
    });

    expect(container.querySelector('.markdown-chart-toggle')).toBeNull();
    expect(container.querySelector('[data-markdown-chart-table="standalone"]')).not.toBeNull();
    expect(fake.createGrid).toHaveBeenCalledOnce();
    const columnDefs = (fake.options().columnDefs ?? []) as ColDef<Row>[];
    expect(columnDefs).toHaveLength(4);
    expect(columnDefs[1]).toMatchObject({ filter: 'agNumberColumnFilter', sort: 'desc', sortIndex: 0 });
    const salesFormatter = columnDefs[1]?.valueFormatter as ((params: unknown) => string);
    expect(salesFormatter({ data: east })).toBe('¥1,280,000');
    const change = columnDefs[2]?.cellRenderer;
    expect(typeof change).toBe('function');
    const changeElement = (change as (params: unknown) => HTMLElement)({ data: east });
    expect(changeElement.textContent).toBe('↑ 12.6%');
    expect(changeElement.dataset.markdownChartTableTone).toBe('positive');
    const sparkline = (columnDefs[3]?.cellRenderer as (params: unknown) => SVGSVGElement)({ data: south });
    expect(sparkline.dataset.markdownChartTableSparkline).toBe('trend');
    expect(sparkline.querySelector('path')?.getAttribute('d')).toContain('M');
    expect(sparkline.querySelector('title')?.textContent).toContain('May: —');

    expect(columnDefs.every((column) => column.floatingFilter === false)).toBe(true);
    expect(columnDefs[0]?.suppressHeaderMenuButton).toBe(false);
    expect(container.querySelector('.markdown-chart-table-export')).toBeNull();
    expect(downloadCsv).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('.markdown-chart-table-search')?.hidden).toBe(true);
    const root = container.querySelector('.markdown-chart-table')!;
    expect(Array.from(root.children).map((child) => child.className)).toEqual([
      'markdown-chart-table-title', 'markdown-chart-table-grid', 'markdown-chart-table-toolbar',
    ]);

    controller.dispose();
    expect(fake.destroy).toHaveBeenCalledOnce();
  });

  it.each(['standalone', 'data-view'] as const)('opens and clears search on demand in %s, with keyboard focus and disposal', async (mode) => {
    const fake = fakeGridRuntime();
    const data = { kind: 'inline', source: [{ region: 'East' }, { region: 'South' }] } as const;
    const container = document.createElement('div');
    document.body.append(container);
    const registry = new ChartRendererRegistry().register(createTableRenderer({ loadGrid: () => fake.runtime }));
    const controller = new ChartController(registry);
    const provider = createTableDataViewProvider({
      loadGrid: () => fake.runtime,
      labels: { searchPlaceholder: '搜索数据', rowCount: (visible, total) => `${visible} / ${total} 行` },
    });
    const handle = mode === 'data-view'
      ? await provider.mount(container, data, { signal: new AbortController().signal, theme: 'dark', labels: DEFAULT_MARKDOWN_CHART_LABELS })
      : (await controller.render(container, { language: 'markdown-chart', source: envelope(data, {}) }), controller);
    const search = container.querySelector<HTMLInputElement>('.markdown-chart-table-search')!;
    const toggle = container.querySelector<HTMLButtonElement>('.markdown-chart-table-search-toggle')!;
    expect(search.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe(mode === 'data-view' ? '搜索数据' : 'Search data');
    expect(container.querySelector('.markdown-chart-table-export')).toBeNull();
    expect(container.querySelector('.markdown-chart-table-title')).toBeNull();
    expect(container.querySelector('.markdown-chart-table-row-count')?.textContent).toBe(mode === 'data-view' ? '2 / 2 行' : '2 of 2 rows');
    toggle.click();
    expect(search.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(search);
    search.value = 'south';
    search.dispatchEvent(new Event('input'));
    expect(fake.setGridOption).toHaveBeenLastCalledWith('quickFilterText', 'south');
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(search.hidden).toBe(false);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(search.hidden).toBe(true);
    expect(search.value).toBe('');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(fake.setGridOption).toHaveBeenLastCalledWith('quickFilterText', '');
    toggle.click();
    search.value = 'east';
    search.dispatchEvent(new Event('input'));
    toggle.click();
    expect(search.hidden).toBe(true);
    expect(search.value).toBe('');
    expect(fake.setGridOption).toHaveBeenLastCalledWith('quickFilterText', '');
    handle?.dispose();
    const calls = fake.setGridOption.mock.calls.length;
    toggle.click();
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(fake.setGridOption).toHaveBeenCalledTimes(calls);
    expect(fake.destroy).toHaveBeenCalledOnce();
    container.remove();
  });

  it('infers numeric and boolean columns while keeping strings and all-null columns textual', async () => {
    const fake = fakeGridRuntime();
    await render(envelope({
      kind: 'inline',
      source: [
        { amount: 10, active: true, dateLike: '2026-09-18', mixed: 1, empty: null },
        { amount: 2, active: false, dateLike: '2026-09-19', mixed: '2', empty: null },
      ],
    }, {}), { loadGrid: () => fake.runtime });
    const defs = (fake.options().columnDefs ?? []) as ColDef<Row>[];
    expect(defs.map((column) => column.filter)).toEqual([
      'agNumberColumnFilter', 'agTextColumnFilter', 'agTextColumnFilter', 'agTextColumnFilter', 'agTextColumnFilter',
    ]);
    const amountComparator = defs[0]?.comparator as (...args: unknown[]) => number;
    expect(amountComparator(2, 10, undefined, undefined, false)).toBeLessThan(0);
    expect(amountComparator(2, 10, undefined, undefined, true)).toBeLessThan(0);
    expect(amountComparator(null, 10, undefined, undefined, false)).toBeGreaterThan(0);
    expect(amountComparator(null, 10, undefined, undefined, true)).toBeLessThan(0);
  });

  it('sorts explicit dates chronologically', async () => {
    const fake = fakeGridRuntime();
    await render(envelope({
      kind: 'inline',
      source: [{ day: '2026-01-01' }, { day: '2025-12-31' }],
    }, {
      columns: [{ field: 'day', type: 'date' }],
    }), { loadGrid: () => fake.runtime });
    const defs = (fake.options().columnDefs ?? []) as ColDef<Row>[];
    const comparator = defs[0]?.comparator as (...args: unknown[]) => number;
    expect(comparator(
      new Date('2026-01-01T00:00:00Z'),
      new Date('2025-12-31T00:00:00Z'),
      undefined,
      undefined,
      false,
    )).toBeGreaterThan(0);
  });

  it('computes a column sparkline extent without spreading large value arrays', async () => {
    const fake = fakeGridRuntime();
    const fields = Array.from({ length: 50 }, (_, index) => `v${index}`);
    const source = Array.from({ length: 4_000 }, (_, rowIndex) => Object.fromEntries(
      fields.map((field, fieldIndex) => [field, rowIndex + fieldIndex]),
    ));
    await render(envelope({ kind: 'ref', ref: 'dataset:wide', format: 'json' }, {
      columns: [{ id: 'trend', cell: { kind: 'sparkline', fields } }],
    }), {
      resolveDataRef: async () => ({ source }),
      loadGrid: () => fake.runtime,
    });
    expect(fake.createGrid).toHaveBeenCalledOnce();
  });

  it('materializes referenced data with independent table limits', async () => {
    const fake = fakeGridRuntime();
    const rows = Array.from({ length: 2_500 }, (_, index) => [index, index * 2]);
    const resolveDataRef = vi.fn(async () => ({ dimensions: ['id', 'value'], source: rows }));
    await render(envelope({ kind: 'ref', ref: 'dataset:large', format: 'json' }, {}), {
      resolveDataRef,
      loadGrid: () => fake.runtime,
    });
    expect(resolveDataRef).toHaveBeenCalledOnce();
    expect(fake.options().rowData).toHaveLength(2_500);

    await expect(render(envelope({
      kind: 'inline', dimensions: ['id'], source: [[1], [2]],
    }, {}), {
      limits: { maxRows: 1 },
      loadGrid: () => fake.runtime,
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('rejects incompatible typed values, invalid dates, and out-of-range unclamped bars', async () => {
    const fake = fakeGridRuntime();
    await expect(render(envelope(
      { kind: 'inline', source: [{ amount: '10' }] },
      { columns: [{ field: 'amount', type: 'number' }] },
    ), { loadGrid: () => fake.runtime })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    await expect(render(envelope(
      { kind: 'inline', source: [{ date: '2026-09-18T10:00:00' }] },
      { columns: [{ field: 'date', type: 'date' }] },
    ), { loadGrid: () => fake.runtime })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    await expect(render(envelope(
      { kind: 'inline', source: [{ rate: 2 }] },
      { columns: [{ field: 'rate', type: 'number', cell: { kind: 'progress', min: 0, max: 1, clamp: false } }] },
    ), { loadGrid: () => fake.runtime })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });
});

describe('table Data view provider and CSV helper', () => {
  it('accepts only bounded table data', () => {
    const provider = createTableDataViewProvider({ limits: { maxRows: 1, maxCells: 2 } });
    expect(provider.supports({ kind: 'inline', source: [{ first: 1, second: 2 }] })).toBe(true);
    expect(provider.supports({ kind: 'inline', source: [{ first: 1 }, { first: 2 }] })).toBe(false);
    const graph = {
      kind: 'inline',
      shape: 'graph',
      source: { nodes: [{ id: 'a', name: 'A' }], links: [] },
    } satisfies ChartData;
    expect(provider.supports(graph)).toBe(false);
  });

  it('budgets the dense materialized table and bounds inferred columns', async () => {
    const provider = createTableDataViewProvider({ limits: { maxRows: 2, maxCells: 4 } });
    const sparseRows = { kind: 'inline', source: [{ first: 1, second: 2 }, { third: 3, fourth: 4 }] } as const;
    expect(provider.supports(sparseRows)).toBe(false);

    await expect(render(envelope(sparseRows, {}), {
      limits: { maxRows: 2, maxCells: 4 },
      loadGrid: () => fakeGridRuntime().runtime,
    })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const tooWide = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field_${index}`, index]));
    expect(createTableDataViewProvider().supports({ kind: 'inline', source: [tooWide] })).toBe(false);
    await expect(render(envelope({ kind: 'inline', source: [tooWide] }, {}), {
      loadGrid: () => fakeGridRuntime().runtime,
    })).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
  });

  it('serializes raw values with CSV escaping and formula text protection', () => {
    expect(serializeTableCsv([
      { name: 'A, B', value: 0, active: false, empty: null, formula: '  +1' },
    ], ['name', 'value', 'active', 'empty', 'formula'])).toBe(
      'name,value,active,empty,formula\r\n"A, B",0,false,,\'  +1',
    );
  });
});
