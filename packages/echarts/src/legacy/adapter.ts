import { MarkdownChartError } from '@datafe/markdown-chart';
import { parseLegacyArtifactCsv } from './csv';
import { sanitizeLegacyEChartSource } from './sanitize';
import { executeLegacyChartSource } from './sandbox';
import type {
  LegacyArtifactLimits,
  LegacyEChartQueryBlock,
  ResolveLegacyArtifactContent,
  ResolvedLegacyEChartQuery,
} from './types';

export interface ResolveLegacyArtifactQueryOptions {
  readonly block: LegacyEChartQueryBlock;
  readonly signal: AbortSignal;
  readonly resolveArtifactContent: ResolveLegacyArtifactContent;
  readonly limits: LegacyArtifactLimits;
}

/** @deprecated Orchestrator for the temporary ChatBI migration adapter. */
export async function resolveLegacyArtifactQuery(
  options: ResolveLegacyArtifactQueryOptions,
): Promise<ResolvedLegacyEChartQuery> {
  let content: unknown;
  try {
    content = await options.resolveArtifactContent({
      language: options.block.language,
      jobId: options.block.jobId,
      index: options.block.index,
      signal: options.signal,
    });
  } catch (cause) {
    if (options.signal.aborted) {
      throw cause;
    }
    throw new MarkdownChartError(
      'REF_RESOLUTION_FAILED',
      'The temporary ChatBI ArtifactContent could not be resolved',
      { cause },
    );
  }
  if (typeof content !== 'string') {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'resolveLegacyArtifactContent must return the raw CSV ArtifactContent string',
    );
  }
  if (options.signal.aborted) {
    throw new DOMException('The temporary legacy chart operation was aborted', 'AbortError');
  }

  const data = parseLegacyArtifactCsv(content, options.limits);
  const source = sanitizeLegacyEChartSource(options.block.source);
  if (!source) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'Temporary legacy chart source is empty after sanitization',
    );
  }
  const spec = await executeLegacyChartSource({
    source,
    inputData: data.source,
    signal: options.signal,
    timeoutMs: options.limits.executionTimeoutMs,
  });
  return { data, spec };
}
