// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartController, ChartRendererRegistry } from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  createLegacySandboxErrorClassifier,
  createLegacySandboxHostAdapter,
  waitForLegacySandboxAbortable,
  type LegacySandboxAbortablePromiseLike,
  type LegacySandboxBinding,
  type LegacySandboxFile,
  type LegacySandboxHostContext,
  type LegacySandboxTransport,
} from '../src/index';

interface TestFile extends LegacySandboxFile {
  readonly content: string;
}

function testFile(): TestFile {
  return {
    fileName: 'chatbi_query_42.csv',
    filePath: 'chatbi_query_42.csv',
    originalFilePath: '',
    fileType: 'csv',
    content: 'name,value\nA,1\n',
  };
}

function context(overrides: Partial<LegacySandboxHostContext> = {}): LegacySandboxHostContext {
  return {
    sessionId: 'session-1',
    requestId: 'request-1',
    phase: 'live',
    cacheScopeKey: 'tenant-1:user-1',
    ...overrides,
  };
}

function resolveArtifact(
  binding: LegacySandboxBinding,
  signal = new AbortController().signal,
): Promise<string> {
  return Promise.resolve(binding.resolveLegacyArtifactContent({
    language: 'echarts-chatbi_query_42-0',
    jobId: 'chatbi_query_42',
    index: 0,
    signal,
  }));
}

function deferredAbortable<T>(abortImplementation?: () => void): {
  readonly request: LegacySandboxAbortablePromiseLike<T>;
  readonly abort: ReturnType<typeof vi.fn>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
} {
  let resolveRequest!: (value: T) => void;
  let rejectRequest!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const abort = vi.fn(abortImplementation);
  return {
    request: Object.assign(promise, { abort }),
    abort,
    resolve: resolveRequest,
    reject: rejectRequest,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('waitForLegacySandboxAbortable', () => {
  it('settles a successful request once, removes its listener, and ignores later abort', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const deferred = deferredAbortable<string>();
    const result = waitForLegacySandboxAbortable(deferred.request, controller.signal);

    deferred.resolve('ready');
    await expect(result).resolves.toBe('ready');
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort(new Error('too late'));
    expect(deferred.abort).not.toHaveBeenCalled();
  });

  it('settles a rejected request once and removes its listener', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const deferred = deferredAbortable<string>();
    const failure = new Error('request failed');
    const result = waitForLegacySandboxAbortable(deferred.request, controller.signal);

    deferred.reject(failure);
    await expect(result).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    controller.abort(new Error('too late'));
    expect(deferred.abort).not.toHaveBeenCalled();
  });

  it('aborts an already-cancelled request immediately with the signal reason', async () => {
    const controller = new AbortController();
    const reason = new Error('already cancelled');
    controller.abort(reason);
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const deferred = deferredAbortable<string>();

    await expect(waitForLegacySandboxAbortable(deferred.request, controller.signal))
      .rejects.toBe(reason);
    expect(deferred.abort).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
  });

  it('observes late settlement after an already-cancelled request without changing its reason', async () => {
    const rejectedController = new AbortController();
    const rejectedReason = new Error('already cancelled before late rejection');
    rejectedController.abort(rejectedReason);
    const rejected = deferredAbortable<string>();
    const rejectedResult = waitForLegacySandboxAbortable(
      rejected.request,
      rejectedController.signal,
    );

    const resolvedController = new AbortController();
    const resolvedReason = new Error('already cancelled before late resolution');
    resolvedController.abort(resolvedReason);
    const resolved = deferredAbortable<string>();
    const resolvedResult = waitForLegacySandboxAbortable(
      resolved.request,
      resolvedController.signal,
    );

    await expect(rejectedResult).rejects.toBe(rejectedReason);
    await expect(resolvedResult).rejects.toBe(resolvedReason);

    const unhandledReasons: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
      unhandledReasons.push(reason);
    };
    process.on('unhandledRejection', recordUnhandled);
    try {
      rejected.reject(new Error('late rejection'));
      resolved.resolve('late resolution');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandledReasons).toEqual([]);
      await expect(rejectedResult).rejects.toBe(rejectedReason);
      await expect(resolvedResult).rejects.toBe(resolvedReason);
      expect(rejected.abort).toHaveBeenCalledOnce();
      expect(resolved.abort).toHaveBeenCalledOnce();
    } finally {
      process.off('unhandledRejection', recordUnhandled);
    }
  });

  it('aborts an in-flight request once and ignores its later settlement', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel in flight');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const deferred = deferredAbortable<string>();
    const result = waitForLegacySandboxAbortable(deferred.request, controller.signal);

    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(deferred.abort).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    deferred.resolve('late result');
    await Promise.resolve();
    expect(deferred.abort).toHaveBeenCalledOnce();
  });

  it('keeps the signal reason when the imperative abort hook throws', async () => {
    const controller = new AbortController();
    const reason = new Error('authoritative reason');
    const deferred = deferredAbortable<string>(() => {
      throw new Error('abort hook failed');
    });
    const result = waitForLegacySandboxAbortable(deferred.request, controller.signal);

    controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(deferred.abort).toHaveBeenCalledOnce();
  });
});

describe('createLegacySandboxErrorClassifier', () => {
  it.each([
    [404, 'not-found'],
    [408, 'retryable'],
    [425, 'retryable'],
    [429, 'retryable'],
    [500, 'retryable'],
    [599, 'retryable'],
    [400, 'fatal'],
    [401, 'fatal'],
    [600, 'fatal'],
  ] as const)('classifies status %s as %s', (status, expected) => {
    const classify = createLegacySandboxErrorClassifier();
    expect(classify({ status }, 'list')).toBe(expected);
  });

  it('recurses through structural fields and safely terminates circular input', () => {
    const classify = createLegacySandboxErrorClassifier();
    const circular: Record<string, unknown> = {};
    circular.response = circular;
    circular.data = { cause: circular, raw: { httpStatusCode: '503' } };

    expect(classify(circular, 'read')).toBe('retryable');
    expect(classify(new Response('', { status: 404 }), 'read')).toBe('not-found');
    const nestedError = new Error('outer', {
      cause: { request: { response: { statusCode: '403' } } },
    });
    expect(classify(nestedError, 'list')).toBe('fatal');
  });

  it('uses extension callbacks in precedence order and passes the operation', () => {
    const getFailureKind = vi.fn(() => undefined);
    const getStatus = vi.fn(() => '429');
    const isRetryableError = vi.fn(() => false);
    const classify = createLegacySandboxErrorClassifier({
      getFailureKind,
      getStatus,
      isRetryableError,
    });
    const error = new Error('custom');

    expect(classify(error, 'read')).toBe('retryable');
    expect(getFailureKind).toHaveBeenCalledWith(error, 'read');
    expect(getStatus).toHaveBeenCalledWith(error);
    expect(isRetryableError).not.toHaveBeenCalled();

    const override = createLegacySandboxErrorClassifier({
      getFailureKind: () => 'fatal',
      getStatus: () => 404,
      isRetryableError: () => true,
    });
    expect(override(error, 'list')).toBe('fatal');
  });

  it('falls back after absent or throwing extensions and never inspects messages', () => {
    const retryable = createLegacySandboxErrorClassifier({
      getFailureKind: () => { throw new Error('extension failed'); },
      getStatus: () => undefined,
      isRetryableError: () => true,
    });
    expect(retryable(new Error('HTTP 404 timeout'), 'list')).toBe('retryable');

    const classify = createLegacySandboxErrorClassifier();
    expect(classify(new Error('HTTP 404 timeout'), 'list')).toBe('fatal');
    expect(classify(new TypeError('network failed'), 'list')).toBe('retryable');
    expect(classify({ name: 'NetworkError', message: 'opaque' }, 'read')).toBe('retryable');
    expect(classify({ name: 'TimeoutError', message: 'opaque' }, 'read')).toBe('retryable');
  });
});

describe('createLegacySandboxHostAdapter', () => {
  function makeTransport() {
    const selected = testFile();
    const listFiles = vi.fn<LegacySandboxTransport<TestFile>['listFiles']>(async () => [selected]);
    const readFile = vi.fn<LegacySandboxTransport<TestFile>['readFile']>(
      async ({ file }) => file.content,
    );
    const transport: LegacySandboxTransport<TestFile> = {
      listFiles,
      readFile,
      classifyError: () => 'fatal',
    };
    return { transport, listFiles, readFile };
  }

  it('normalizes identity and returns no binding without session or principal scope', () => {
    const host = makeTransport();
    const adapter = createLegacySandboxHostAdapter({ transport: host.transport });

    expect(adapter.identity(context({
      sessionId: '  session-1  ',
      requestId: '   ',
      cacheScopeKey: '  tenant-1:user-1 ',
      phase: 'final',
    }))).toBe(JSON.stringify(['tenant-1:user-1', 'session-1', '', 'final']));
    expect(adapter.bind(context({ sessionId: ' ' }))).toBeUndefined();
    expect(adapter.bind(context({ cacheScopeKey: ' ' }))).toBeUndefined();
    expect(adapter).not.toHaveProperty('reset');
  });

  it('reuses one client per principal and discards its cache on principal switches', async () => {
    const host = makeTransport();
    const adapter = createLegacySandboxHostAdapter({ transport: host.transport });

    await resolveArtifact(adapter.bind(context())!);
    await resolveArtifact(adapter.bind(context({ requestId: ' request-1 ' }))!);
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.listFiles).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      requestId: 'request-1',
    }));

    await resolveArtifact(adapter.bind(context({ cacheScopeKey: 'tenant-1:user-2' }))!);
    await resolveArtifact(adapter.bind(context({ cacheScopeKey: 'tenant-1:user-1' }))!);
    expect(host.listFiles).toHaveBeenCalledTimes(3);
    expect(host.readFile).toHaveBeenCalledTimes(3);
    expect(adapter.identity(context({ cacheScopeKey: 'tenant-1:user-2' })))
      .not.toBe(adapter.identity(context()));
  });

  it('keeps client caches isolated between adapter instances', async () => {
    const host = makeTransport();
    const first = createLegacySandboxHostAdapter({ transport: host.transport });
    const second = createLegacySandboxHostAdapter({ transport: host.transport });

    await resolveArtifact(first.bind(context())!);
    await resolveArtifact(second.bind(context())!);
    await resolveArtifact(first.bind(context())!);
    await resolveArtifact(second.bind(context())!);
    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
  });

  it('uses identity replacement plus controller disposal to abort the old login generation', async () => {
    const pending = deferredAbortable<readonly TestFile[]>();
    const listFiles = vi.fn<LegacySandboxTransport<TestFile>['listFiles']>(
      ({ signal }) => waitForLegacySandboxAbortable(pending.request, signal),
    );
    const readFile = vi.fn<LegacySandboxTransport<TestFile>['readFile']>(async () => '');
    const transport: LegacySandboxTransport<TestFile> = {
      listFiles,
      readFile,
      classifyError: () => 'fatal',
    };
    const adapter = createLegacySandboxHostAdapter({ transport });
    const oldContext = context({ cacheScopeKey: 'tenant-1:user-1' });
    const nextContext = context({ cacheScopeKey: 'tenant-1:user-2' });
    const oldBinding = adapter.bind(oldContext);
    if (!oldBinding) throw new Error('Expected the old host context to bind');
    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      legacySandbox: oldBinding,
    }));
    const controller = new ChartController(registry);
    const render = controller.render(document.createElement('div'), {
      language: 'echarts-chatbi_query_42-0',
      source: 'var option = {};',
    });
    await vi.waitFor(() => expect(listFiles).toHaveBeenCalledOnce());

    expect(adapter.identity(nextContext)).not.toBe(adapter.identity(oldContext));
    expect(adapter.bind(nextContext)).toBeDefined();
    controller.dispose();
    await render;
    expect(pending.abort).toHaveBeenCalledOnce();
    expect(readFile).not.toHaveBeenCalled();
  });
});
