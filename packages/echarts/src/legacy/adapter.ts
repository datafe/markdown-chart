import { MarkdownChartError } from '@datafe-open/markdown-chart';
import { parseLegacyArtifactCsv } from './csv';
import { sanitizeLegacyEChartSource } from './sanitize';
import { executeLegacyChartSource } from './sandbox';
import { LegacySandboxError } from './types';
import type {
  LegacyArtifactLimits,
  LegacyEChartQueryBlock,
  LegacyEChartSandboxFileBlock,
  ResolveLegacyArtifactContent,
  ResolveLegacySandboxFileContent,
  ResolvedLegacyEChartQuery,
} from './types';

export interface ResolveLegacyArtifactQueryOptions {
  readonly block: LegacyEChartQueryBlock;
  readonly signal: AbortSignal;
  readonly resolveArtifactContent: ResolveLegacyArtifactContent;
  readonly limits: LegacyArtifactLimits;
  readonly preserveLegacySandboxError?: boolean;
}

interface ResolveLegacyChartOptions {
  readonly source: string;
  readonly signal: AbortSignal;
  readonly limits: LegacyArtifactLimits;
  readonly resolveContent: () => string | Promise<string>;
  readonly resolutionError: string;
  readonly returnTypeError: string;
  readonly preserveLegacySandboxError: boolean;
}

async function resolveLegacyChart(
  options: ResolveLegacyChartOptions,
): Promise<ResolvedLegacyEChartQuery> {
  let content: unknown;
  try {
    content = await options.resolveContent();
  } catch (cause) {
    if (options.signal.aborted) {
      throw cause;
    }
    if (options.preserveLegacySandboxError && cause instanceof LegacySandboxError) {
      throw cause;
    }
    throw new MarkdownChartError('REF_RESOLUTION_FAILED', options.resolutionError, { cause });
  }
  if (typeof content !== 'string') {
    throw new MarkdownChartError('SCHEMA_INVALID', options.returnTypeError);
  }
  if (options.signal.aborted) {
    throw new DOMException('The temporary legacy chart operation was aborted', 'AbortError');
  }

  const data = parseLegacyArtifactCsv(content, options.limits);
  const source = sanitizeLegacyEChartSource(options.source);
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

/** @deprecated Orchestrator for the temporary ChatBI migration adapter. */
export async function resolveLegacyArtifactQuery(
  options: ResolveLegacyArtifactQueryOptions,
): Promise<ResolvedLegacyEChartQuery> {
  return resolveLegacyChart({
    source: options.block.source,
    signal: options.signal,
    limits: options.limits,
    resolveContent: () => options.resolveArtifactContent({
      language: options.block.language,
      jobId: options.block.jobId,
      index: options.block.index,
      signal: options.signal,
    }),
    resolutionError: 'The temporary ChatBI ArtifactContent could not be resolved',
    returnTypeError: 'resolveLegacyArtifactContent must return the raw CSV ArtifactContent string',
    preserveLegacySandboxError: options.preserveLegacySandboxError === true,
  });
}

export interface ResolveLegacySandboxFileOptions {
  readonly block: LegacyEChartSandboxFileBlock;
  readonly signal: AbortSignal;
  readonly resolveSandboxFileContent: ResolveLegacySandboxFileContent;
  readonly limits: LegacyArtifactLimits;
  readonly preserveLegacySandboxError?: boolean;
}

/** @deprecated Orchestrator for the temporary ChatBI sandbox-file adapter. */
export async function resolveLegacySandboxFile(
  options: ResolveLegacySandboxFileOptions,
): Promise<ResolvedLegacyEChartQuery> {
  return resolveLegacyChart({
    source: options.block.source,
    signal: options.signal,
    limits: options.limits,
    resolveContent: () => options.resolveSandboxFileContent({
      language: options.block.language,
      filePath: options.block.filePath,
      signal: options.signal,
    }),
    resolutionError: 'The temporary ChatBI sandbox file could not be resolved',
    returnTypeError: 'resolveLegacySandboxFileContent must return a raw CSV string',
    preserveLegacySandboxError: options.preserveLegacySandboxError === true,
  });
}
