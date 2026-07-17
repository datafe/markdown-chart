import {
  MarkdownChartError,
  type InlineChartData,
  type JsonValue,
} from '@datafe-open/markdown-chart';

/** @deprecated Temporary ChatBI migration format. Remove with the legacy adapter. */
export interface LegacyEChartQueryBlock {
  readonly language: string;
  readonly jobId: string;
  readonly index: number;
  readonly source: string;
}

/** @deprecated Temporary ChatBI migration format. Remove with the legacy adapter. */
export interface LegacyEChartQueryRequest extends LegacyEChartQueryBlock {
  readonly signal: AbortSignal;
}

/** @deprecated Temporary ChatBI migration format. Remove with the legacy adapter. */
export interface ResolvedLegacyEChartQuery {
  readonly data: InlineChartData;
  readonly spec: Record<string, JsonValue>;
}

/**
 * @deprecated Advanced escape hatch for the temporary ChatBI migration format.
 * Prefer `ResolveLegacyArtifactContent` while the migration is active.
 */
export type ResolveLegacyEChartQuery = (
  request: LegacyEChartQueryRequest,
) => ResolvedLegacyEChartQuery | Promise<ResolvedLegacyEChartQuery>;

/** @deprecated Request for the temporary ChatBI artifact-content adapter. */
export interface LegacyArtifactContentRequest {
  readonly language: string;
  readonly jobId: string;
  readonly index: number;
  readonly signal: AbortSignal;
}

/**
 * @deprecated Temporary ChatBI migration hook. Return the raw CSV
 * `ArtifactContent` supplied by GetAgentSessionArtifactMeta.
 */
export type ResolveLegacyArtifactContent = (
  request: LegacyArtifactContentRequest,
) => string | Promise<string>;

/** @deprecated Resource limits for the temporary ChatBI adapter. */
export interface LegacyArtifactLimits {
  readonly maxArtifactContentBytes: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
  readonly executionTimeoutMs: number;
}

/** @deprecated Defaults for the temporary ChatBI adapter. */
export const DEFAULT_LEGACY_ARTIFACT_LIMITS: Readonly<LegacyArtifactLimits> = Object.freeze({
  maxArtifactContentBytes: 5 * 1024 * 1024,
  maxRows: 2_000,
  maxColumns: 200,
  maxCells: 40_000,
  executionTimeoutMs: 5_000,
});

/** @deprecated Limit normalization for the temporary ChatBI adapter. */
export function resolveLegacyArtifactLimits(
  inherited: Pick<LegacyArtifactLimits, 'maxRows' | 'maxCells'>,
  overrides: Partial<LegacyArtifactLimits> | undefined,
): LegacyArtifactLimits {
  const limits = {
    ...DEFAULT_LEGACY_ARTIFACT_LIMITS,
    ...inherited,
    ...overrides,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        `legacyArtifactLimits.${name} must be a positive safe integer`,
      );
    }
  }
  return limits;
}
