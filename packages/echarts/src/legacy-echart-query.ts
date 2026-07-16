import {
  MarkdownChartError,
  type InlineChartData,
  type JsonValue,
} from '@datafe/markdown-chart';

const LEGACY_ECHART_QUERY_LANGUAGE = /^echarts-chatbi_query_(\d+)-(\d+)$/;

/** @deprecated Temporary ChatBI migration hook. Do not use for new content. */
export interface LegacyEChartQueryBlock {
  readonly language: string;
  readonly jobId: string;
  readonly index: number;
  readonly source: string;
}

/** @deprecated Temporary ChatBI migration hook. Do not use for new content. */
export interface LegacyEChartQueryRequest extends LegacyEChartQueryBlock {
  readonly signal: AbortSignal;
}

/** @deprecated Temporary ChatBI migration hook. Do not use for new content. */
export interface ResolvedLegacyEChartQuery {
  readonly data: InlineChartData;
  readonly spec: Record<string, JsonValue>;
}

/** @deprecated Temporary ChatBI migration hook. Do not use for new content. */
export type ResolveLegacyEChartQuery = (
  request: LegacyEChartQueryRequest,
) => ResolvedLegacyEChartQuery | Promise<ResolvedLegacyEChartQuery>;

export function isLegacyEChartQueryLanguage(language: string): boolean {
  return LEGACY_ECHART_QUERY_LANGUAGE.test(language);
}

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
