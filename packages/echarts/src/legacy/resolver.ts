import {
  isLegacyEChartQueryLanguage,
  isLegacyEChartSandboxFileLanguage,
} from './matcher';
import {
  LegacySandboxError,
  type CreateLegacySandboxClientOptions,
  type LegacyArtifactContentRequest,
  type LegacySandboxBinding,
  type LegacySandboxClient,
  type LegacySandboxContext,
  type LegacySandboxErrorCode,
  type LegacySandboxFailureKind,
  type LegacySandboxFile,
  type LegacySandboxFileContentRequest,
  type LegacySandboxTransport,
} from './types';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 64;
const REQUEST_ATTEMPTS = 4;
const REQUEST_DELAYS_MS = [1_000, 2_000, 4_000] as const;
const SESSION_ATTEMPTS = 6;
const SESSION_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

interface CacheEntry {
  readonly content: string;
  readonly expiresAt: number;
}

interface CacheWriteState {
  latestGeneration: number;
  activeResolutions: number;
}

interface ArtifactLookup {
  readonly identity: string;
  readonly jobId?: string;
  readonly filePath?: string;
  readonly signal: AbortSignal;
}

function errorCode(kind: LegacySandboxFailureKind): LegacySandboxErrorCode {
  if (kind === 'not-found') return 'LEGACY_SANDBOX_NOT_FOUND';
  if (kind === 'retryable') return 'LEGACY_SANDBOX_RETRYABLE';
  return 'LEGACY_SANDBOX_FATAL';
}

function failureKind(error: LegacySandboxError): LegacySandboxFailureKind {
  if (error.code === 'LEGACY_SANDBOX_NOT_FOUND') return 'not-found';
  if (error.code === 'LEGACY_SANDBOX_RETRYABLE') return 'retryable';
  return 'fatal';
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The legacy sandbox request was aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal);
}

function isAbortError(cause: unknown): boolean {
  if (cause instanceof Error) return cause.name === 'AbortError';
  if (!cause || typeof cause !== 'object') return false;

  // DOMException has a brand-checking name getter, which also recognizes
  // instances created in another realm without trusting an arbitrary `name`.
  if (typeof DOMException !== 'undefined') {
    const nameGetter = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get;
    if (nameGetter) {
      try {
        if (nameGetter.call(cause) === 'AbortError') return true;
      } catch {
        // Not a DOMException with the required internal slots.
      }
    }
  }

  // Cross-realm Error instances fail `instanceof Error` but retain this brand.
  // Requiring both the Error brand and a string message deliberately rejects a
  // plain `{ name: 'AbortError' }` transport payload.
  try {
    if (Object.prototype.hasOwnProperty.call(cause, Symbol.toStringTag)) return false;
    return Object.prototype.toString.call(cause) === '[object Error]'
      && Reflect.get(cause, 'name') === 'AbortError'
      && typeof Reflect.get(cause, 'message') === 'string';
  } catch {
    return false;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(abortError(signal));
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function normalizeCandidate(value: unknown): string {
  if (typeof value !== 'string') return '';
  let normalized = value.trim().replace(/\\/g, '/');
  const suffixIndex = normalized.search(/[?#]/);
  if (suffixIndex >= 0) normalized = normalized.slice(0, suffixIndex);
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Invalid percent escapes remain literal and can only match the same literal path.
  }
  normalized = normalized.replace(/\/+/g, '/');
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/^\/+/, '');
    if (normalized.startsWith('./')) normalized = normalized.slice(2);
  } while (normalized !== previous);
  return normalized;
}

function fileCandidates(file: LegacySandboxFile): readonly string[] {
  return [...new Set([
    normalizeCandidate(file.fileName),
    normalizeCandidate(file.filePath),
    normalizeCandidate(file.originalFilePath),
  ].filter(Boolean))];
}

function isCsvFile(file: LegacySandboxFile, candidates: readonly string[]): boolean {
  const type = typeof file.fileType === 'string' ? file.fileType.trim().toLowerCase() : '';
  return type === 'csv'
    || type === 'text/csv'
    || type === 'application/csv'
    || candidates.some((candidate) => candidate.toLowerCase().endsWith('.csv'));
}

function baseName(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? path : path.slice(index + 1);
}

function uniqueMatch<File extends LegacySandboxFile>(
  entries: readonly { readonly file: File; readonly candidates: readonly string[] }[],
  predicate: (candidate: string) => boolean,
): File | undefined {
  const matches = entries.filter(({ candidates }) => candidates.some(predicate));
  if (matches.length > 1) {
    throw new LegacySandboxError(
      'LEGACY_SANDBOX_NOT_FOUND',
      'The legacy sandbox file match was ambiguous',
    );
  }
  return matches[0]?.file;
}

function selectFile<File extends LegacySandboxFile>(
  files: readonly File[],
  lookup: Pick<ArtifactLookup, 'jobId' | 'filePath'>,
): File {
  const entries = files.flatMap((file) => {
    const candidates = fileCandidates(file);
    return candidates.length > 0 && isCsvFile(file, candidates)
      ? [{ file, candidates }]
      : [];
  });

  if (lookup.jobId) {
    const expectedName = `${lookup.jobId}.csv`;
    const matched = uniqueMatch(entries, (candidate) => baseName(candidate) === expectedName);
    if (matched) return matched;
  }

  const target = normalizeCandidate(lookup.filePath);
  if (target) {
    const exact = uniqueMatch(entries, (candidate) => candidate === target);
    if (exact) return exact;
    const suffix = uniqueMatch(entries, (candidate) => candidate.endsWith(`/${target}`));
    if (suffix) return suffix;
  }

  throw new LegacySandboxError(
    'LEGACY_SANDBOX_NOT_FOUND',
    'The requested legacy sandbox CSV file was not found',
  );
}

function normalizeFailure<File extends LegacySandboxFile>(
  transport: LegacySandboxTransport<File>,
  cause: unknown,
  operation: 'list' | 'read',
): LegacySandboxError {
  if (cause instanceof LegacySandboxError) return cause;
  let kind: LegacySandboxFailureKind;
  try {
    kind = transport.classifyError(cause, operation);
  } catch (classificationCause) {
    return new LegacySandboxError(
      'LEGACY_SANDBOX_FATAL',
      'The legacy sandbox transport error could not be classified',
      { cause: classificationCause },
    );
  }
  return new LegacySandboxError(
    errorCode(kind),
    `The legacy sandbox ${operation} operation failed`,
    { cause },
  );
}

async function lookupOnce<File extends LegacySandboxFile>(
  transport: LegacySandboxTransport<File>,
  context: LegacySandboxContext,
  lookup: ArtifactLookup,
  requestId: string | undefined,
): Promise<string> {
  throwIfAborted(lookup.signal);
  let files: readonly File[];
  try {
    files = await transport.listFiles({
      sessionId: context.sessionId,
      ...(requestId ? { requestId } : {}),
      signal: lookup.signal,
    });
  } catch (cause) {
    throwIfAborted(lookup.signal);
    if (isAbortError(cause)) throw cause;
    throw normalizeFailure(transport, cause, 'list');
  }
  throwIfAborted(lookup.signal);
  if (!Array.isArray(files) || files.some((file) => (
    !file
    || typeof file.fileName !== 'string'
    || typeof file.filePath !== 'string'
    || typeof file.originalFilePath !== 'string'
    || typeof file.fileType !== 'string'
  ))) {
    throw new LegacySandboxError(
      'LEGACY_SANDBOX_FATAL',
      'The legacy sandbox transport returned an invalid file descriptor list',
    );
  }
  const file = selectFile(files, lookup);
  let content: unknown;
  try {
    content = await transport.readFile({
      sessionId: context.sessionId,
      file,
      signal: lookup.signal,
    });
  } catch (cause) {
    throwIfAborted(lookup.signal);
    if (isAbortError(cause)) throw cause;
    throw normalizeFailure(transport, cause, 'read');
  }
  throwIfAborted(lookup.signal);
  if (typeof content !== 'string') {
    throw new LegacySandboxError(
      'LEGACY_SANDBOX_FATAL',
      'The legacy sandbox transport returned non-string file content',
    );
  }
  return content;
}

async function runStage<File extends LegacySandboxFile>(
  transport: LegacySandboxTransport<File>,
  context: LegacySandboxContext,
  lookup: ArtifactLookup,
  requestId: string | undefined,
  attempts: number,
  delays: readonly number[],
): Promise<string> {
  let lastFailure: LegacySandboxError | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await lookupOnce(transport, context, lookup, requestId);
    } catch (cause) {
      throwIfAborted(lookup.signal);
      if (isAbortError(cause)) throw cause;
      const failure = cause instanceof LegacySandboxError
        ? cause
        : normalizeFailure(transport, cause, 'list');
      if (failureKind(failure) === 'fatal') throw failure;
      lastFailure = failure;
      if (attempt === attempts - 1) throw failure;
      await delay(delays[attempt] as number, lookup.signal);
    }
  }
  throw lastFailure ?? new LegacySandboxError(
    'LEGACY_SANDBOX_FATAL',
    'The legacy sandbox lookup did not run',
  );
}

function cacheKey(context: LegacySandboxContext, identity: string): string {
  return JSON.stringify([
    context.cacheScopeKey,
    context.sessionId,
    context.requestId ?? '',
    context.phase,
    identity,
  ]);
}

function shouldUseCache(context: LegacySandboxContext): boolean {
  return context.phase !== 'final' || context.requestId !== undefined;
}

/** Create a principal-safe client for temporary legacy sandbox CSV resolution. */
export function createLegacySandboxClient<
  File extends LegacySandboxFile = LegacySandboxFile,
>(
  options: CreateLegacySandboxClientOptions<File>,
): LegacySandboxClient<File> {
  const cache = new Map<string, CacheEntry>();
  const cacheWriteStates = new Map<string, CacheWriteState>();

  const readCache = (key: string): string | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.content;
  };

  const writeCache = (key: string, content: string): void => {
    cache.delete(key);
    cache.set(key, { content, expiresAt: Date.now() + CACHE_TTL_MS });
    while (cache.size > CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const beginCacheResolution = (key: string): number => {
    const state = cacheWriteStates.get(key) ?? {
      latestGeneration: 0,
      activeResolutions: 0,
    };
    state.latestGeneration += 1;
    state.activeResolutions += 1;
    cacheWriteStates.set(key, state);
    return state.latestGeneration;
  };

  const isLatestCacheResolution = (key: string, generation: number): boolean => (
    cacheWriteStates.get(key)?.latestGeneration === generation
  );

  const finishCacheResolution = (key: string): void => {
    const state = cacheWriteStates.get(key);
    if (!state) return;
    state.activeResolutions -= 1;
    if (state.activeResolutions === 0) cacheWriteStates.delete(key);
  };

  const bind = (input: LegacySandboxContext): LegacySandboxBinding => {
    const cacheScopeKey = typeof input.cacheScopeKey === 'string'
      ? input.cacheScopeKey.trim()
      : '';
    if (!cacheScopeKey) {
      throw new LegacySandboxError(
        'LEGACY_SANDBOX_CONFIGURATION_CONFLICT',
        'cacheScopeKey must be a non-empty principal identity',
      );
    }
    const requestId = typeof input.requestId === 'string'
      ? input.requestId.trim() || undefined
      : undefined;
    const context: LegacySandboxContext = {
      sessionId: input.sessionId,
      phase: input.phase,
      cacheScopeKey,
      ...(requestId ? { requestId } : {}),
    };

    const resolve = async (lookup: ArtifactLookup): Promise<string> => {
      throwIfAborted(lookup.signal);
      if (context.phase === 'live' && !context.requestId) {
        throw new LegacySandboxError(
          'LEGACY_SANDBOX_NOT_FOUND',
          'The legacy sandbox request identity is not available while streaming',
        );
      }
      const key = cacheKey(context, lookup.identity);
      const useCache = shouldUseCache(context);
      if (useCache) {
        const cached = readCache(key);
        if (cached !== undefined) return cached;
      }
      const cacheGeneration = useCache ? beginCacheResolution(key) : undefined;

      try {
        let content: string;
        if (context.phase === 'final') {
          content = await runStage(
            options.transport,
            context,
            lookup,
            undefined,
            SESSION_ATTEMPTS,
            SESSION_DELAYS_MS,
          );
        } else {
          try {
            content = await runStage(
              options.transport,
              context,
              lookup,
              context.requestId,
              REQUEST_ATTEMPTS,
              REQUEST_DELAYS_MS,
            );
          } catch (cause) {
            if (!(cause instanceof LegacySandboxError)
              || cause.code !== 'LEGACY_SANDBOX_NOT_FOUND') {
              throw cause;
            }
            content = await runStage(
              options.transport,
              context,
              lookup,
              undefined,
              SESSION_ATTEMPTS,
              SESSION_DELAYS_MS,
            );
          }
        }
        throwIfAborted(lookup.signal);
        if (useCache
          && cacheGeneration !== undefined
          && isLatestCacheResolution(key, cacheGeneration)) {
          writeCache(key, content);
        }
        return content;
      } finally {
        if (useCache && cacheGeneration !== undefined) finishCacheResolution(key);
      }
    };

    return {
      resolveLegacyArtifactContent: (request: LegacyArtifactContentRequest) => resolve({
        identity: JSON.stringify(['artifact', request.language, request.jobId, request.index]),
        jobId: request.jobId,
        signal: request.signal,
      }),
      resolveLegacySandboxFileContent: (request: LegacySandboxFileContentRequest) => resolve({
        identity: JSON.stringify(['sandbox-file', request.language, request.filePath]),
        filePath: request.filePath,
        signal: request.signal,
      }),
      shouldDefer: (language: string) => context.phase === 'live'
        && !context.requestId
        && (isLegacyEChartQueryLanguage(language)
          || isLegacyEChartSandboxFileLanguage(language)),
    };
  };

  return { bind };
}
