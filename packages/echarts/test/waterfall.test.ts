// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as echarts from 'echarts';
import { ChartController, ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer, type EChartsRuntime } from '../src/index';
import chinese from '../../../examples/shared/waterfall-zh.json';
import english from '../../../examples/shared/waterfall-en.json';

// ECharts exposes these model methods at runtime, but not on EChartsType.
interface BarModel {
  getData(): {
    getItemLayout(index: number): { y: number; height: number };
    getItemGraphicEl(index: number): { shape: { r: number }; style: { fill: string; opacity: number } };
  };
  formatTooltip(index: number, multiple: boolean): { blocks: Array<{ name: string; value: unknown }> };
}
interface ChartModel { getSeriesByIndex(index: number): BarModel }

echarts.setPlatformAPI({ measureText: text => ({ width: [...String(text)].length * 8 }) });

describe('standard waterfall through the canonical renderer', () => {
  it.each([chinese, english])('preserves signed geometry, labels and tooltips for $spec.title.text', async (fixture) => {
    for (const theme of ['light', 'dark']) {
      for (const reference of [false, true]) {
        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 900, height: 460 });
        const runtime: EChartsRuntime = {
          init: () => ({
            setOption: option => chart.setOption({ ...option, animation: false } as echarts.EChartsOption),
            resize() {}, dispose: () => chart.dispose(),
          }),
        };
        const controller = new ChartController(new ChartRendererRegistry().register(createEChartsRenderer({
          loadECharts: () => runtime, resizeObserver: false,
          resolveDataRef: async () => fixture.data,
        })));
        try {
          await controller.render(document.createElement('div'), {
            language: 'markdown-chart', theme,
            source: JSON.stringify({ ...fixture, data: reference ? { kind: 'ref', ref: 'demo://waterfall' } : fixture.data }),
          });
          const model = (chart as unknown as { getModel(): ChartModel }).getModel();
          const svg = chart.renderToSVGString();
          fixture.data.source.forEach((row, index) => {
            const total = row[1] === 'total';
            const change = row[2] as number;
            const balance = row[3] as number;
            const seriesIndex = total ? 3 : change >= 0 ? 1 : 2;
            const series = model.getSeriesByIndex(seriesIndex);
            const layout = series.getData().getItemLayout(index);
            const start = chart.convertToPixel({ yAxisIndex: 0 }, total ? 0 : balance - change) as number;
            const end = chart.convertToPixel({ yAxisIndex: 0 }, balance) as number;
            expect(Math.min(layout.y, layout.y + layout.height)).toBeCloseTo(Math.min(start, end), 5);
            expect(Math.abs(layout.height)).toBeCloseTo(Math.abs(start - end), 5);
            const graphic = series.getData().getItemGraphicEl(index);
            expect(graphic.style.fill).toBe(fixture.spec.series[seriesIndex]!.itemStyle.color);
            expect(graphic.shape.r).toBe(0);
            const blocks = series.formatTooltip(index, false).blocks;
            if (total) expect(blocks.flatMap(block => block.value)).toEqual([balance]);
            else expect(blocks.filter(block => ['change', 'balance'].includes(block.name)).map(({ name, value }) => [name, value]))
              .toEqual([['change', change], ['balance', balance]]);
            expect(svg).toContain(`>${row[seriesIndex + 7]}<`);
          });
          expect(svg).not.toContain('>null<');
          expect(model.getSeriesByIndex(0).getData().getItemGraphicEl(2).style.opacity).toBe(0);
          const option = chart.getOption();
          expect((option.legend as Array<{ selectedMode: boolean }>)[0]?.selectedMode).toBe(false);
        } finally { controller.dispose(); }
      }
    }
  });

  it('handles all-negative balances, negative totals and zero change', async () => {
    const fixture = structuredClone(english);
    fixture.data.source = [
      ['Open', 'total', null, -100, 0, 0, 0, -100, null, null, '-100'],
      ['Loss', 'change', -20, -120, -120, 0, 20, 0, null, '-20', null],
      ['Recovery', 'change', 40, -80, -120, 40, 0, 0, '+40', null, null],
      ['Unchanged', 'change', 0, -80, -80, 0, 0, 0, '0', null, null],
      ['Close', 'total', null, -80, 0, 0, 0, -80, null, null, '-80'],
    ];
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 420 });
    const controller = new ChartController(new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: () => ({ init: () => ({ setOption: option => chart.setOption({ ...option, animation: false } as echarts.EChartsOption), resize() {}, dispose: () => chart.dispose() }) }),
      resizeObserver: false,
    })));
    try {
      await controller.render(document.createElement('div'), { language: 'markdown-chart', source: JSON.stringify(fixture) });
      const model = (chart as unknown as { getModel(): ChartModel }).getModel();
      for (const [row, seriesIndex, from, to] of [[0, 3, 0, -100], [1, 2, -100, -120], [2, 1, -120, -80], [3, 1, -80, -80], [4, 3, 0, -80]]) {
        const layout = model.getSeriesByIndex(seriesIndex!).getData().getItemLayout(row!);
        const start = chart.convertToPixel({ yAxisIndex: 0 }, from!) as number;
        const end = chart.convertToPixel({ yAxisIndex: 0 }, to!) as number;
        expect(Math.min(layout.y, layout.y + layout.height)).toBeCloseTo(Math.min(start, end), 5);
        expect(Math.abs(layout.height)).toBeCloseTo(Math.abs(start - end), 5);
      }
      expect(chart.renderToSVGString()).toContain('>0<');
    } finally { controller.dispose(); }
  });

  it.each([{ series: [{ type: 'waterfall' }] }, { series: { type: 'waterfall' } }])('rejects a nonexistent native waterfall series', async ({ series }) => {
    const controller = new ChartController(new ChartRendererRegistry().register(createEChartsRenderer()));
    await expect(controller.render(document.createElement('div'), {
      language: 'markdown-chart', source: JSON.stringify({ version: 1, renderer: 'echarts', spec: { series } }),
    })).rejects.toMatchObject({ code: 'SCHEMA_INVALID', message: expect.stringContaining('stacked bar') });
  });
});
