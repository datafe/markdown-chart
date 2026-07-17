import { MarkdownChartError } from '@datafe-open/markdown-chart';
import type { LegacyEChartQueryBlock } from './types';

const LEGACY_ECHART_QUERY_LANGUAGE = /^echarts-chatbi_query_(\d+)-(\d+)$/;

/** @deprecated Temporary ChatBI migration matcher. */
export function isLegacyEChartQueryLanguage(language: string): boolean {
  return LEGACY_ECHART_QUERY_LANGUAGE.test(language);
}

/** @deprecated Temporary ChatBI migration parser. */
export function parseLegacyEChartQueryBlock(
  language: string,
  source: string,
): LegacyEChartQueryBlock {
  const match = LEGACY_ECHART_QUERY_LANGUAGE.exec(language);
  if (!match) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      `Invalid temporary EChart query language: ${language}`,
    );
  }
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) {
    throw new MarkdownChartError('SCHEMA_INVALID', 'Temporary EChart query index is too large');
  }
  return {
    language,
    jobId: `chatbi_query_${match[1]}`,
    index,
    source: source.trim(),
  };
}
