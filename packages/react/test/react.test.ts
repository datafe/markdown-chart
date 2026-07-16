import { describe, expect, it } from 'vitest';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { isRegisteredChartLanguage } from '../src/index';

describe('react-markdown chart routing', () => {
  it('recognizes canonical chart fences without renderer defaults', () => {
    expect(isRegisteredChartLanguage('chart', undefined)).toBe(true);
    expect(isRegisteredChartLanguage('echarts', undefined)).toBe(false);
  });

  it('consults the live provider registry for renderer aliases', () => {
    const registry = new ChartRendererRegistry();
    expect(isRegisteredChartLanguage('plotly-json', registry)).toBe(false);
    registry.register({
      id: 'plotly',
      aliases: ['plotly-json'],
      parse: (spec) => spec,
      mount() {},
    });
    expect(isRegisteredChartLanguage('plotly-json', registry)).toBe(true);
  });
});
