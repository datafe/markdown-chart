import { MarkdownChartError } from '@datafe-open/markdown-chart';
import type { LegacyEChartQueryBlock, LegacyEChartSandboxFileBlock } from './types';

const LEGACY_ECHART_QUERY_LANGUAGE = /^echarts-chatbi_query_(\d+)-(\d+)$/;
const LEGACY_ECHART_SANDBOX_FILE_LANGUAGE = /^echarts-chatbi_sandbox_filepath_(\S+)$/i;

/** @deprecated Temporary ChatBI migration matcher. */
export function isLegacyEChartQueryLanguage(language: string): boolean {
  return LEGACY_ECHART_QUERY_LANGUAGE.test(language);
}

/** @deprecated Temporary ChatBI migration matcher. */
export function isLegacyEChartSandboxFileLanguage(language: string): boolean {
  return LEGACY_ECHART_SANDBOX_FILE_LANGUAGE.test(language);
}

/** @deprecated Temporary ChatBI migration matcher. */
export function isLegacyEChartLanguage(language: string): boolean {
  return isLegacyEChartQueryLanguage(language)
    || isLegacyEChartSandboxFileLanguage(language);
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

/** @deprecated Temporary ChatBI migration parser. */
export function parseLegacyEChartSandboxFileBlock(
  rawLanguage: string,
  source: string,
): LegacyEChartSandboxFileBlock {
  const match = LEGACY_ECHART_SANDBOX_FILE_LANGUAGE.exec(rawLanguage);
  const filePath = match?.[1];
  if (!filePath) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      `Invalid temporary EChart sandbox file language: ${rawLanguage}`,
    );
  }
  return {
    language: rawLanguage,
    filePath,
    source: source.trim(),
  };
}
