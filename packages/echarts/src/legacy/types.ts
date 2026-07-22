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

/** @deprecated Temporary ChatBI sandbox-file migration format. */
export interface LegacyEChartSandboxFileBlock {
  readonly language: string;
  readonly filePath: string;
  readonly source: string;
}

/** Internal materialized result for the temporary legacy sandbox orchestrator. */
export interface ResolvedLegacyEChartQuery {
  readonly data: InlineChartData;
  readonly spec: Record<string, JsonValue>;
}

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

/** @deprecated Request for a temporary ChatBI sandbox file. */
export interface LegacySandboxFileContentRequest {
  readonly language: string;
  readonly filePath: string;
  readonly signal: AbortSignal;
}

/**
 * @deprecated Temporary ChatBI migration hook. Return the raw CSV content for
 * the requested sandbox file. The host owns session, request, and HTTP state.
 */
export type ResolveLegacySandboxFileContent = (
  request: LegacySandboxFileContentRequest,
) => string | Promise<string>;

/** Descriptor returned by a host legacy sandbox file listing. */
export interface LegacySandboxFile {
  readonly fileName: string;
  readonly filePath: string;
  readonly originalFilePath: string;
  readonly fileType: string;
}

/** Principal- and turn-scoped context bound to a legacy sandbox client. */
export interface LegacySandboxContext {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly phase: 'live' | 'final';
  readonly cacheScopeKey: string;
}

export type LegacySandboxFailureKind = 'not-found' | 'retryable' | 'fatal';

export type LegacySandboxErrorCode =
  | 'LEGACY_SANDBOX_NOT_FOUND'
  | 'LEGACY_SANDBOX_RETRYABLE'
  | 'LEGACY_SANDBOX_FATAL'
  | 'LEGACY_SANDBOX_CONFIGURATION_CONFLICT';

/** Stable public failure emitted by the shared legacy sandbox client. */
export class LegacySandboxError extends Error {
  readonly code: LegacySandboxErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: LegacySandboxErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options && 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'LegacySandboxError';
    this.code = code;
    this.cause = options?.cause;
  }
}

/** Host-owned authenticated file transport. */
export interface LegacySandboxTransport<
  File extends LegacySandboxFile = LegacySandboxFile,
> {
  listFiles(input: {
    readonly sessionId: string;
    readonly requestId?: string;
    readonly signal: AbortSignal;
  }): Promise<readonly File[]>;
  readFile(input: {
    readonly sessionId: string;
    readonly file: File;
    readonly signal: AbortSignal;
  }): Promise<string>;
  classifyError(
    error: unknown,
    operation: 'list' | 'read',
  ): LegacySandboxFailureKind;
}

/** Resolver pair and streaming gate bound to one host context. */
export interface LegacySandboxBinding {
  readonly resolveLegacyArtifactContent: ResolveLegacyArtifactContent;
  readonly resolveLegacySandboxFileContent: ResolveLegacySandboxFileContent;
  readonly shouldDefer: (language: string) => boolean;
}

export interface LegacySandboxClient<
  File extends LegacySandboxFile = LegacySandboxFile,
> {
  bind(context: LegacySandboxContext): LegacySandboxBinding;
}

export interface CreateLegacySandboxClientOptions<
  File extends LegacySandboxFile = LegacySandboxFile,
> {
  readonly transport: LegacySandboxTransport<File>;
}

/** Promise-like host request that may expose an imperative cancellation hook. */
export interface LegacySandboxAbortablePromiseLike<T> extends PromiseLike<T> {
  abort?(): void;
}

/** Host-specific extensions for the shared structural error classifier. */
export interface LegacySandboxErrorClassifierOptions {
  readonly getFailureKind?: (
    error: unknown,
    operation: 'list' | 'read',
  ) => LegacySandboxFailureKind | undefined;
  readonly getStatus?: (error: unknown) => number | string | undefined;
  readonly isRetryableError?: (error: unknown) => boolean;
}

/** Optional host context normalized before binding the shared sandbox client. */
export interface LegacySandboxHostContext {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly phase: 'live' | 'final';
  readonly cacheScopeKey?: string;
}

/** Stable host-facing lifecycle wrapper around a private sandbox client. */
export interface LegacySandboxHostAdapter {
  bind(context: LegacySandboxHostContext): LegacySandboxBinding | undefined;
  identity(context: LegacySandboxHostContext): string;
}

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
