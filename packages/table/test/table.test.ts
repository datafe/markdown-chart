// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
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

  it('builds typed AG Grid columns, custom cells, search, raw CSV, and direct presentation', async () => {
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

    const search = container.querySelector<HTMLInputElement>('.markdown-chart-table-search') as HTMLInputElement;
    search.value = 'south';
    search.dispatchEvent(new Event('input'));
    expect(fake.setGridOption).toHaveBeenCalledWith('quickFilterText', 'south');

    container.querySelector<HTMLButtonElement>('.markdown-chart-table-export')?.click();
    expect(downloadCsv).toHaveBeenCalledOnce();
    const [csv, filename] = downloadCsv.mock.calls[0] as [string, string];
    expect(filename).toBe('Regional-performance.csv');
    expect(csv.split('\r\n')[0]).toBe('region,sales,growth,apr,may,jun,note');
    expect(csv.split('\r\n')[1]).toBe('South,960000,-0.035,103,,96,review');
    expect(csv.split('\r\n')[2]).toContain("'=SUM(A1:A2)");
    expect(csv).not.toContain('¥');
    expect(csv).not.toContain('trend');

    controller.dispose();
    expect(fake.destroy).toHaveBeenCalledOnce();
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

  it('serializes raw values with CSV escaping and formula text protection', () => {
    expect(serializeTableCsv([
      { name: 'A, B', value: 0, active: false, empty: null, formula: '  +1' },
    ], ['name', 'value', 'active', 'empty', 'formula'])).toBe(
      'name,value,active,empty,formula\r\n"A, B",0,false,,\'  +1',
    );
  });
});
