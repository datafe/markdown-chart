import { describe, expect, it } from 'vitest';
import { semanticExamples } from './semantic-examples';

describe('bilingual example messages', () => {
  it('delivers four complete chart envelopes with consistent language colors', () => {
    const charts = [...semanticExamples.matchAll(/```markdown-chart\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!));
    expect(charts.map(chart => chart.renderer)).toEqual(['kpi', 'echarts', 'kpi', 'echarts']);
    expect(charts[0].spec.colorConvention).toBe('red-up-green-down');
    expect(charts[2].spec.colorConvention).toBe('green-up-red-down');
    expect(charts[1].spec.series[1].itemStyle.color).toBe('#d93025');
    expect(charts[3].spec.series[1].itemStyle.color).toBe('#138a55');
    expect(charts[1].data.source.map((row: unknown[]) => row.slice(1))).toEqual(charts[3].data.source.map((row: unknown[]) => row.slice(1)));
  });
});
