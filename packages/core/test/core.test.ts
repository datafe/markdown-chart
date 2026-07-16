// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  ChartController,
  ChartRendererRegistry,
  MarkdownChartError,
  parseChartJson,
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
      spec: { data: [] },
    }));

    expect(prepared.rendererId).toBe('plotly');
    expect(prepared.parsed).toBe('{"data":[]}');
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
