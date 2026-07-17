import { describe, expect, it } from 'vitest';
import { parseLegacyArtifactCsv } from '../src/legacy/csv';
import {
  isLegacyEChartQueryLanguage,
  parseLegacyEChartQueryBlock,
} from '../src/legacy/matcher';
import { sanitizeLegacyEChartSource } from '../src/legacy/sanitize';
import {
  DEFAULT_LEGACY_ARTIFACT_LIMITS,
  type LegacyArtifactLimits,
} from '../src/legacy/types';

function limits(overrides: Partial<LegacyArtifactLimits> = {}): LegacyArtifactLimits {
  return { ...DEFAULT_LEGACY_ARTIFACT_LIMITS, ...overrides };
}

describe('temporary legacy matcher', () => {
  it('recognizes only the ChatBI query language and derives its job id', () => {
    expect(isLegacyEChartQueryLanguage('echarts-chatbi_query_42-3')).toBe(true);
    expect(isLegacyEChartQueryLanguage('echarts')).toBe(false);
    expect(isLegacyEChartQueryLanguage('markdown-chart')).toBe(false);
    expect(parseLegacyEChartQueryBlock(
      'echarts-chatbi_query_42-3',
      ' var option = {}; ',
    )).toEqual({
      language: 'echarts-chatbi_query_42-3',
      jobId: 'chatbi_query_42',
      index: 3,
      source: 'var option = {};',
    });
  });
});

describe('temporary legacy CSV parser', () => {
  it('uses dynamic JSON scalar typing and returns inspectable inline rows', () => {
    expect(parseLegacyArtifactCsv(
      'category,value,active,empty\nA,10,true,\nB,2.5,false,\n',
      limits(),
    )).toEqual({
      kind: 'inline',
      dimensions: ['category', 'value', 'active', 'empty'],
      source: [
        { category: 'A', value: 10, active: true, empty: null },
        { category: 'B', value: 2.5, active: false, empty: null },
      ],
    });
  });

  it('bounds UTF-8 bytes, rows, columns, and cells independently', () => {
    expect(() => parseLegacyArtifactCsv('名称,value\n甲,1\n', limits({
      maxArtifactContentBytes: 8,
    }))).toThrow(/UTF-8 byte limit/);
    expect(() => parseLegacyArtifactCsv('a\n1\n2\n', limits({ maxRows: 1 })))
      .toThrow(/1 row limit/);
    expect(() => parseLegacyArtifactCsv('a,b,c\n1,2,3\n', limits({ maxColumns: 2 })))
      .toThrow(/2 column limit/);
    expect(() => parseLegacyArtifactCsv('a,b\n1,2\n3,4\n', limits({ maxCells: 3 })))
      .toThrow(/3 cell limit/);
  });

  it('rejects malformed, duplicate, and prototype-related headers', () => {
    expect(() => parseLegacyArtifactCsv('a,a\n1,2\n', limits())).toThrow(/unique/);
    expect(() => parseLegacyArtifactCsv('__proto__,value\nA,1\n', limits())).toThrow(/not allowed/);
    expect(() => parseLegacyArtifactCsv('a,b\n"unterminated,1\n', limits())).toThrow(/not valid CSV/);
  });
});

describe('temporary legacy source sanitizer', () => {
  it('removes host rendering lines and inline/end sentinels but preserves option code', () => {
    const source = [
      "const chart = echarts.init(document.getElementById('main'));",
      'var option = { series: [] };//#end',
      'chart.setOption(option);',
    ].join('\n');
    expect(sanitizeLegacyEChartSource(source)).toBe('var option = { series: [] };');
  });
});
