// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ChartController, ChartRendererRegistry, MarkdownChartError } from '@datafe-open/markdown-chart';
import { createKpiRenderer, parseKpiSpec } from '../src/index';

function kpiSpec() {
  return {
    items: [
      {
        id: 'unmet_demand',
        title: '未满足需求',
        value: '40',
        suffix: '%',
        status: { text: '流失中', tone: 'negative' },
        references: [
          { ref: 'docs://metrics/unmet-demand', label: '未满足需求口径' },
          { ref: 'docs://metrics/unmet-demand-trend', label: '未满足需求趋势说明' },
        ],
      },
      {
        id: 'lost_revenue',
        title: '累计流失营收',
        value: '720',
        suffix: '万',
        references: [{ ref: 'docs://metrics/lost-revenue', label: '累计流失营收口径' }],
      },
      {
        id: 'incremental_revenue',
        title: 'Estimated incremental revenue with a deliberately long title',
        prefix: '¥',
        value: '1,800',
        suffix: '万',
        status: { text: '预计可挽回', tone: 'positive' },
      },
      {
        id: 'store_inventory',
        title: '门店库存',
        value: '23/48',
        status: { text: '家庭低于安全水平', tone: 'warning' },
      },
    ],
  };
}

function envelope(spec: unknown = kpiSpec(), data?: unknown): string {
  return JSON.stringify({
    version: 1,
    renderer: 'kpi',
    ...(data === undefined ? {} : { data }),
    spec,
  });
}

describe('KPI schema', () => {
  it('accepts 1-12 items and preserves formatted display strings', () => {
    const parsed = parseKpiSpec(kpiSpec());
    expect(parsed.items).toHaveLength(4);
    expect(parsed.items[2]).toMatchObject({ prefix: '¥', value: '1,800', suffix: '万' });
    expect(parseKpiSpec({ items: [{ id: 'only', title: 'Only', value: '23/48' }] }).items)
      .toHaveLength(1);
  });

  it.each([
    [{ items: [] }, 'items'],
    [{ items: [{ id: 'bad id', title: 'Title', value: '1' }] }, 'id'],
    [{ items: [{ id: 'a', title: 'Title', value: '1' }, { id: 'a', title: 'Again', value: '2' }] }, 'unique'],
    [{ items: [{ id: 'a', title: ' Title', value: '1' }] }, 'trimmed'],
    [{ items: [{ id: 'a', title: 'Title', value: '1', extra: true }] }, 'not allowed'],
    [{ items: [{ id: 'a', title: 'Title', value: '1', status: { text: 'Bad', tone: 'critical' } }] }, 'tone'],
    [{ items: [{ id: 'a', title: 'Title', value: '1', references: [] }] }, 'references'],
    [{ items: [{ id: 'a', title: 'Title', value: '1', references: [
      { ref: 'docs://same', label: 'First' },
      { ref: 'docs://same', label: 'Second' },
    ] }] }, 'duplicate'],
  ])('rejects an invalid renderer spec %#', (spec, message) => {
    expect(() => parseKpiSpec(spec)).toThrowError(message);
  });

  it('rejects canonical data instead of creating shared Chart/Data chrome', () => {
    expect(() => parseKpiSpec(kpiSpec(), true)).toThrowError(MarkdownChartError);
  });

  it('enforces item and per-item reference bounds', () => {
    expect(() => parseKpiSpec({
      items: Array.from({ length: 13 }, (_, index) => ({
        id: `metric_${index}`,
        title: `Metric ${index}`,
        value: String(index),
      })),
    })).toThrowError('1-12');
    expect(() => parseKpiSpec({
      items: [{
        id: 'metric',
        title: 'Metric',
        value: '1',
        references: Array.from({ length: 4 }, (_, index) => ({
          ref: `docs://metric/${index}`,
          label: `Reference ${index}`,
        })),
      }],
    })).toThrowError('1-3');
  });
});

describe('KPI mount and opaque references', () => {
  it('renders four responsive cards and dispatches only independently approved references', async () => {
    const canOpen = vi.fn(({ reference }) => reference.ref !== 'docs://metrics/lost-revenue');
    const open = vi.fn();
    const registry = new ChartRendererRegistry().register(createKpiRenderer());
    const controller = new ChartController(registry);
    const container = document.createElement('div');
    container.style.minHeight = '360px';

    await controller.render(container, {
      language: 'markdown-chart',
      source: envelope(),
      theme: 'dark',
      referenceActions: { canOpen, open },
    });

    const cards = container.querySelectorAll('[data-markdown-chart-kpi-id]');
    expect(cards).toHaveLength(4);
    expect(container.style.minHeight).toBe('0');
    expect(container.querySelector<HTMLElement>('.markdown-chart-kpi-grid')?.style.gridTemplateColumns)
      .toContain('auto-fit');
    expect(container.querySelector('[data-markdown-chart-kpi-id="incremental_revenue"]')?.textContent)
      .toContain('¥1,800万');
    const buttons = container.querySelectorAll<HTMLButtonElement>('[data-markdown-chart-kpi-reference]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.title).toBe('未满足需求口径');
    expect(buttons[0]?.dataset.markdownChartKpiReference).toBe('1');
    expect(buttons[1]?.dataset.markdownChartKpiReference).toBe('2');
    buttons[0]?.click();
    buttons[1]?.click();
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenNthCalledWith(1, {
      rendererId: 'kpi',
      reference: { ref: 'docs://metrics/unmet-demand', label: '未满足需求口径' },
    });
    expect(open).toHaveBeenNthCalledWith(2, {
      rendererId: 'kpi',
      reference: { ref: 'docs://metrics/unmet-demand-trend', label: '未满足需求趋势说明' },
    });
    expect(canOpen).toHaveBeenCalledTimes(5);

    controller.dispose();
    expect(container.querySelector('.markdown-chart-kpi-grid')).toBeNull();
    expect(container.style.minHeight).toBe('360px');
  });

  it('renders content without controls when a host does not provide actions', async () => {
    const controller = new ChartController(
      new ChartRendererRegistry().register(createKpiRenderer()),
    );
    const container = document.createElement('div');
    await controller.render(container, { language: 'markdown-chart', source: envelope() });
    expect(container.querySelectorAll('[data-markdown-chart-kpi-id]')).toHaveLength(4);
    expect(container.querySelector('[data-markdown-chart-kpi-reference]')).toBeNull();
    controller.dispose();
  });

  it('fails closed when host predicates or open handlers throw', async () => {
    const source = envelope({
      items: [{
        id: 'metric',
        title: 'Metric',
        value: '1',
        references: [
          { ref: 'docs://predicate-error', label: 'Predicate error' },
          { ref: 'docs://open-error', label: 'Open error' },
        ],
      }],
    });
    const controller = new ChartController(
      new ChartRendererRegistry().register(createKpiRenderer()),
    );
    const container = document.createElement('div');
    await controller.render(container, {
      language: 'markdown-chart',
      source,
      referenceActions: {
        canOpen: ({ reference }) => {
          if (reference.ref.endsWith('predicate-error')) throw new Error('predicate');
          return true;
        },
        open: () => { throw new Error('open'); },
      },
    });
    const button = container.querySelector<HTMLButtonElement>('[data-markdown-chart-kpi-reference]');
    expect(button).not.toBeNull();
    expect(() => button?.click()).not.toThrow();
    controller.dispose();
  });
});
