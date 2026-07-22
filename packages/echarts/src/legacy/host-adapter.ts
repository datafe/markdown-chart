import { createLegacySandboxClient } from './resolver';
import type {
  LegacySandboxAbortablePromiseLike,
  LegacySandboxBinding,
  LegacySandboxClient,
  LegacySandboxErrorClassifierOptions,
  LegacySandboxFailureKind,
  LegacySandboxFile,
  LegacySandboxHostAdapter,
  LegacySandboxHostContext,
  LegacySandboxTransport,
} from './types';

const STATUS_FIELDS = [
  'status',
  'statusCode',
  'httpStatus',
  'httpStatusCode',
  'code',
] as const;
const NESTED_ERROR_FIELDS = ['raw', 'data', 'response', 'request', 'cause'] as const;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason
    ?? new DOMException('The legacy sandbox host request was aborted', 'AbortError');
}

/** Wait for a host request while settling cancellation exactly once. */
export function waitForLegacySandboxAbortable<T>(
  request: LegacySandboxAbortablePromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    const settleResolve = (value: T): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const settleReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };
    const abortRequest = (): void => {
      try {
        request.abort?.();
      } catch {
        // The AbortSignal reason remains the authoritative cancellation result.
      }
    };
    function onAbort(): void {
      if (settled) return;
      abortRequest();
      settleReject(abortReason(signal));
    }

    Promise.resolve(request).then(settleResolve, settleReject);
    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return undefined;
  try {
    return Reflect.get(record, key);
  } catch {
    return undefined;
  }
}

function parseHttpStatus(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && /^\d{3}$/.test(value)
    ? Number(value)
    : value;
  return typeof parsed === 'number'
    && Number.isInteger(parsed)
    && parsed >= 100
    && parsed <= 599
    ? parsed
    : undefined;
}

function nestedCause(value: unknown): unknown {
  if (!(value instanceof Error)) return undefined;
  try {
    return value.cause;
  } catch {
    return undefined;
  }
}

function structuralStatus(value: unknown, visited = new Set<object>()): number | undefined {
  if (!value || typeof value !== 'object' || visited.has(value)) return undefined;
  visited.add(value);

  if (typeof Response !== 'undefined' && value instanceof Response) {
    return parseHttpStatus(value.status);
  }

  const errorCause = nestedCause(value);
  if (errorCause !== undefined) {
    const status = structuralStatus(errorCause, visited);
    if (status !== undefined) return status;
  }

  if (!isPlainRecord(value)) return undefined;
  for (const field of STATUS_FIELDS) {
    const status = parseHttpStatus(ownValue(value, field));
    if (status !== undefined) return status;
  }
  for (const field of NESTED_ERROR_FIELDS) {
    const status = structuralStatus(ownValue(value, field), visited);
    if (status !== undefined) return status;
  }
  return undefined;
}

function retryableStatus(status: number): boolean {
  return status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
}

function errorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (!isPlainRecord(error)) return '';
  const name = ownValue(error, 'name');
  return typeof name === 'string' ? name : '';
}

function extensionResult<T>(callback: (() => T) | undefined): T | undefined {
  if (!callback) return undefined;
  try {
    return callback();
  } catch {
    return undefined;
  }
}

/** Build a message-independent classifier for host HTTP and network failures. */
export function createLegacySandboxErrorClassifier(
  options: LegacySandboxErrorClassifierOptions = {},
): LegacySandboxTransport['classifyError'] {
  return (error, operation): LegacySandboxFailureKind => {
    const hostKind = extensionResult(() => options.getFailureKind?.(error, operation));
    if (hostKind === 'not-found' || hostKind === 'retryable' || hostKind === 'fatal') {
      return hostKind;
    }

    const hostStatus = parseHttpStatus(extensionResult(() => options.getStatus?.(error)));
    const status = hostStatus ?? structuralStatus(error);
    if (status !== undefined) {
      if (status === 404) return 'not-found';
      return retryableStatus(status) ? 'retryable' : 'fatal';
    }

    const name = errorName(error);
    if (error instanceof TypeError || name === 'NetworkError' || name === 'TimeoutError') {
      return 'retryable';
    }
    if (extensionResult(() => options.isRetryableError?.(error)) === true) {
      return 'retryable';
    }
    return 'fatal';
  };
}

function normalizedContext(context: LegacySandboxHostContext): {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly phase: 'live' | 'final';
  readonly cacheScopeKey: string;
} {
  const requestId = context.requestId?.trim();
  return {
    sessionId: context.sessionId?.trim() ?? '',
    phase: context.phase,
    cacheScopeKey: context.cacheScopeKey?.trim() ?? '',
    ...(requestId ? { requestId } : {}),
  };
}

/** Create an adapter with instance-private client and cache state. */
export function createLegacySandboxHostAdapter<
  File extends LegacySandboxFile = LegacySandboxFile,
>(options: {
  readonly transport: LegacySandboxTransport<File>;
}): LegacySandboxHostAdapter {
  const { transport } = options;
  let active: {
    readonly cacheScopeKey: string;
    readonly transport: LegacySandboxTransport<File>;
    readonly client: LegacySandboxClient<File>;
  } | undefined;

  return {
    bind(context): LegacySandboxBinding | undefined {
      const normalized = normalizedContext(context);
      if (!normalized.sessionId || !normalized.cacheScopeKey) return undefined;

      if (!active
        || active.cacheScopeKey !== normalized.cacheScopeKey
        || active.transport !== transport) {
        active = {
          cacheScopeKey: normalized.cacheScopeKey,
          transport,
          client: createLegacySandboxClient({ transport }),
        };
      }
      return active.client.bind(normalized);
    },
    identity(context): string {
      const normalized = normalizedContext(context);
      return JSON.stringify([
        normalized.cacheScopeKey,
        normalized.sessionId,
        normalized.requestId ?? '',
        normalized.phase,
      ]);
    },
  };
}
