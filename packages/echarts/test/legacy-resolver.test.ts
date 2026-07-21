import { afterEach, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createLegacySandboxClient } from '../src/legacy/resolver';
import {
  LegacySandboxError,
  type LegacySandboxBinding,
  type LegacySandboxContext,
  type LegacySandboxFailureKind,
  type LegacySandboxFile,
  type LegacySandboxTransport,
} from '../src/legacy/types';

interface TestFile extends LegacySandboxFile {
  readonly id: string;
  readonly content: string;
}

class HostFailure extends Error {
  constructor(readonly kind: LegacySandboxFailureKind) {
    super(kind);
  }
}

function file(id: string, overrides: Partial<TestFile> = {}): TestFile {
  return {
    id,
    content: `name,value\n${id},1\n`,
    fileName: `${id}.csv`,
    filePath: `${id}.csv`,
    originalFilePath: '',
    fileType: 'csv',
    ...overrides,
  };
}

function transport(initialFiles: readonly TestFile[] = []) {
  const listFiles = vi.fn<LegacySandboxTransport<TestFile>['listFiles']>(async () => initialFiles);
  const readFile = vi.fn<LegacySandboxTransport<TestFile>['readFile']>(
    async ({ file: selected }) => selected.content,
  );
  const classifyError = vi.fn<LegacySandboxTransport<TestFile>['classifyError']>(
    (error: unknown): LegacySandboxFailureKind => (
    error instanceof HostFailure ? error.kind : 'fatal'
    ),
  );
  const value: LegacySandboxTransport<TestFile> = {
    listFiles,
    readFile,
    classifyError,
  };
  return { value, listFiles, readFile, classifyError };
}

type ContextOverrides = Partial<Omit<LegacySandboxContext, 'requestId'>> & {
  readonly requestId?: string | undefined;
};

function context(overrides: ContextOverrides = {}): LegacySandboxContext {
  const result: {
    sessionId: string;
    requestId?: string;
    phase: 'live' | 'final';
    cacheScopeKey: string;
  } = {
    sessionId: overrides.sessionId ?? 'session-1',
    requestId: 'request-1',
    phase: overrides.phase ?? 'live',
    cacheScopeKey: overrides.cacheScopeKey ?? 'tenant-1:user-1',
  };
  if ('requestId' in overrides) {
    if (overrides.requestId === undefined) delete result.requestId;
    else result.requestId = overrides.requestId;
  }
  return result;
}

function resolveArtifact(
  binding: LegacySandboxBinding,
  jobId = 'chatbi_query_42',
  signal = new AbortController().signal,
): Promise<string> {
  return Promise.resolve(binding.resolveLegacyArtifactContent({
    language: 'echarts-chatbi_query_42-0',
    jobId,
    index: 0,
    signal,
  }));
}

function resolvePath(
  binding: LegacySandboxBinding,
  filePath = 'App/CSV/Foo.csv',
  signal = new AbortController().signal,
): Promise<string> {
  return Promise.resolve(binding.resolveLegacySandboxFileContent({
    language: `echarts-chatbi_sandbox_filepath_${filePath}`,
    filePath,
    signal,
  }));
}

function crossRealmAbortError(): unknown {
  return runInNewContext(`
    const error = new Error('cross-realm abort');
    error.name = 'AbortError';
    error;
  `);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createLegacySandboxClient', () => {
  it('requires a non-empty principal scope and exposes no lifecycle surface', () => {
    const host = transport();
    const client = createLegacySandboxClient({ transport: host.value });

    expect(() => client.bind(context({ cacheScopeKey: '   ' }))).toThrowError(
      expect.objectContaining({
        name: 'LegacySandboxError',
        code: 'LEGACY_SANDBOX_CONFIGURATION_CONFLICT',
      }),
    );
    expect(() => client.bind({
      ...context(),
      cacheScopeKey: undefined as unknown as string,
    })).toThrowError(expect.objectContaining({
      code: 'LEGACY_SANDBOX_CONFIGURATION_CONFLICT',
    }));
    expect(client).not.toHaveProperty('dispose');
    expect(client.bind(context())).not.toHaveProperty('dispose');
  });

  it.each([undefined, '', '   '] as const)(
    'normalizes requestId=%j as missing for live deferral and lookup gating',
    async (requestId) => {
      const host = transport();
      const client = createLegacySandboxClient({ transport: host.value });
      const live = client.bind(context({ requestId }));
      const final = client.bind(context({ phase: 'final', requestId }));

      expect(live.shouldDefer('echarts-chatbi_query_42-0')).toBe(true);
      expect(live.shouldDefer('echarts-chatbi_sandbox_filepath_App/Foo.csv')).toBe(true);
      expect(live.shouldDefer('markdown-chart')).toBe(false);
      expect(final.shouldDefer('echarts-chatbi_query_42-0')).toBe(false);
      await expect(resolveArtifact(live)).rejects.toMatchObject({
        code: 'LEGACY_SANDBOX_NOT_FOUND',
      });
      expect(host.listFiles).not.toHaveBeenCalled();
      expect(host.readFile).not.toHaveBeenCalled();
    },
  );

  it('trims a present request identity before transport and cache use', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      requestId: '  request-1  ',
    }));

    expect(binding.shouldDefer('echarts-chatbi_query_42-0')).toBe(false);
    await resolveArtifact(binding);
    await resolveArtifact(binding);
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.listFiles).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-1',
    }));
  });

  it('normalizes descriptors, filters CSV files, and uniquely matches job basenames', async () => {
    const selected = file('selected', {
      fileName: '',
      filePath: '',
      originalFilePath: '  \\tmp\\chatbi_query_42%2Ecsv?download=1#ignored  ',
      fileType: '',
    });
    const host = transport([
      file('non-csv', {
        fileName: 'chatbi_query_42.txt',
        filePath: 'chatbi_query_42.txt',
        fileType: 'text/plain',
      }),
      selected,
    ]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));

    await expect(resolveArtifact(binding)).resolves.toBe(selected.content);
    expect(host.readFile).toHaveBeenCalledWith(expect.objectContaining({ file: selected }));
  });

  it('prefers an exact decoded path over a suffix match', async () => {
    const exact = file('exact', {
      fileName: '',
      filePath: './App%2FCSV%2FFoo.csv#fragment',
      fileType: 'application/csv',
    });
    const suffix = file('suffix', {
      fileName: '',
      filePath: '/root/App/CSV/Foo.csv',
      fileType: 'text/csv',
    });
    const host = transport([suffix, exact]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));

    await expect(resolvePath(binding)).resolves.toBe(exact.content);
    expect(host.readFile).toHaveBeenCalledWith(expect.objectContaining({ file: exact }));
  });

  it('uses a unique case-sensitive suffix only after exact matching misses', async () => {
    const selected = file('suffix', {
      fileName: '',
      filePath: '/root/App/CSV/Foo.csv',
      fileType: '',
    });
    const wrongCase = file('wrong-case', {
      fileName: '',
      filePath: '/root/app/csv/foo.csv',
      fileType: '',
    });
    const host = transport([wrongCase, selected]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));

    await expect(resolvePath(binding)).resolves.toBe(selected.content);
    expect(host.readFile).toHaveBeenCalledWith(expect.objectContaining({ file: selected }));
  });

  it.each([
    ['job basename', [
      file('job-a', { filePath: '/a/chatbi_query_42.csv' }),
      file('job-b', { filePath: '/b/chatbi_query_42.csv' }),
    ], 'artifact'],
    ['exact path', [
      file('exact-a', { filePath: 'App/CSV/Foo.csv' }),
      file('exact-b', { filePath: 'App/CSV/Foo.csv' }),
    ], 'path'],
    ['suffix path', [
      file('suffix-a', { filePath: '/a/App/CSV/Foo.csv' }),
      file('suffix-b', { filePath: '/b/App/CSV/Foo.csv' }),
    ], 'path'],
  ] as const)('fails closed for an ambiguous %s without reading', async (_label, files, mode) => {
    vi.useFakeTimers();
    const host = transport(files);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const promise = mode === 'artifact' ? resolveArtifact(binding) : resolvePath(binding);
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_NOT_FOUND',
    });

    await vi.runAllTimersAsync();
    await assertion;
    expect(host.listFiles).toHaveBeenCalledTimes(6);
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('runs exact request and fallback session schedules before succeeding', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const selected = file('chatbi_query_42');
    const host = transport();
    const calls: Array<[scope: string, at: number]> = [];
    let sessionAttempts = 0;
    host.listFiles.mockImplementation(async ({ requestId }) => {
      calls.push([requestId ?? 'session', Date.now()]);
      if (requestId) throw new HostFailure('not-found');
      sessionAttempts += 1;
      return sessionAttempts === 6 ? [selected] : [];
    });
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());
    const promise = resolveArtifact(binding);
    const assertion = expect(promise).resolves.toBe(selected.content);

    await vi.runAllTimersAsync();
    await assertion;
    expect(host.listFiles).toHaveBeenCalledTimes(10);
    expect(calls).toEqual([
      ['request-1', 0],
      ['request-1', 1_000],
      ['request-1', 3_000],
      ['request-1', 7_000],
      ['session', 7_000],
      ['session', 8_000],
      ['session', 10_000],
      ['session', 14_000],
      ['session', 22_000],
      ['session', 38_000],
    ]);
    expect(host.classifyError).toHaveBeenCalledTimes(4);
    expect(Date.now()).toBe(38_000);
  });

  it('runs final lookups directly in session scope with six not-found attempts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const host = transport([]);
    const calls: number[] = [];
    host.listFiles.mockImplementation(async () => {
      calls.push(Date.now());
      return [];
    });
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const promise = resolveArtifact(binding);
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_NOT_FOUND',
    });

    await vi.runAllTimersAsync();
    await assertion;
    expect(host.listFiles).toHaveBeenCalledTimes(6);
    expect(host.listFiles.mock.calls.every(([input]) => input.requestId === undefined)).toBe(true);
    expect(calls).toEqual([0, 1_000, 3_000, 7_000, 15_000, 31_000]);
    expect(Date.now()).toBe(31_000);
  });

  it('keeps retryable exhaustion in request scope and preserves the cause', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const original = new HostFailure('retryable');
    const host = transport();
    const calls: number[] = [];
    host.listFiles.mockImplementation(async () => {
      calls.push(Date.now());
      throw original;
    });
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());
    const promise = resolveArtifact(binding);
    const assertion = expect(promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_RETRYABLE',
      cause: original,
    });

    await vi.runAllTimersAsync();
    await assertion;
    expect(host.listFiles).toHaveBeenCalledTimes(4);
    expect(host.listFiles.mock.calls.every(([input]) => input.requestId === 'request-1')).toBe(true);
    expect(calls).toEqual([0, 1_000, 3_000, 7_000]);
    expect(Date.now()).toBe(7_000);
  });

  it('fails fatal transport errors immediately', async () => {
    const original = new HostFailure('fatal');
    const host = transport();
    host.listFiles.mockRejectedValue(original);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    await expect(resolveArtifact(binding)).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_FATAL',
      cause: original,
    });
    expect(host.listFiles).toHaveBeenCalledOnce();
  });

  it('treats an invalid runtime descriptor list as fatal schema failure', async () => {
    const host = transport();
    host.listFiles.mockResolvedValue([{ fileName: 'incomplete.csv' } as TestFile]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    await expect(resolveArtifact(binding)).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_FATAL',
    });
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.readFile).not.toHaveBeenCalled();
    expect(host.classifyError).not.toHaveBeenCalled();
  });

  it('restarts listing after a not-found read before succeeding', async () => {
    vi.useFakeTimers();
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    host.readFile
      .mockRejectedValueOnce(new HostFailure('not-found'))
      .mockResolvedValueOnce(selected.content);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const promise = resolveArtifact(binding);
    const assertion = expect(promise).resolves.toBe(selected.content);

    await vi.runAllTimersAsync();
    await assertion;
    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
    expect(host.classifyError).toHaveBeenCalledWith(expect.any(HostFailure), 'read');
  });

  it('isolates cache by principal, phase, and artifact and expires after 30 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const selected = file('chatbi_query_42', { filePath: 'App/CSV/Foo.csv' });
    const host = transport([selected]);
    const client = createLegacySandboxClient({ transport: host.value });
    const scopeA = client.bind(context());

    await resolveArtifact(scopeA);
    await resolveArtifact(scopeA);
    expect(host.listFiles).toHaveBeenCalledTimes(1);

    await resolveArtifact(client.bind(context({ cacheScopeKey: 'tenant-1:user-2' })));
    await resolveArtifact(client.bind(context({ phase: 'final' })));
    await resolvePath(scopeA);
    expect(host.listFiles).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(30_001);
    await resolveArtifact(scopeA);
    expect(host.listFiles).toHaveBeenCalledTimes(5);
  });

  it.each([undefined, '', '   '] as const)(
    'disables final success-cache lookup and writes for requestId=%j',
    async (requestId) => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
      requestId,
    }));

    await resolveArtifact(binding);
    await resolveArtifact(binding);
    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
    expect(host.listFiles.mock.calls.every(([input]) => input.requestId === undefined)).toBe(true);
    },
  );

  it('refreshes LRU recency before evicting the oldest of 64 entries', async () => {
    const files = Array.from({ length: 65 }, (_, index) => file(`job-${index}`));
    const host = transport(files);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    for (let index = 0; index < 64; index += 1) {
      await resolveArtifact(binding, `job-${index}`);
    }
    await resolveArtifact(binding, 'job-0');
    await resolveArtifact(binding, 'job-64');
    await resolveArtifact(binding, 'job-1');
    await resolveArtifact(binding, 'job-0');
    expect(host.listFiles).toHaveBeenCalledTimes(66);
    expect(host.readFile).toHaveBeenCalledTimes(66);
  });

  it('includes session and request in cache keys', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    const client = createLegacySandboxClient({ transport: host.value });

    await resolveArtifact(client.bind(context()));
    await resolveArtifact(client.bind(context({ sessionId: 'session-2' })));
    await resolveArtifact(client.bind(context({ requestId: 'request-2' })));
    await resolveArtifact(client.bind(context()));

    expect(host.listFiles).toHaveBeenCalledTimes(3);
    expect(host.listFiles.mock.calls.map(([input]) => [input.sessionId, input.requestId]))
      .toEqual([
        ['session-1', 'request-1'],
        ['session-2', 'request-1'],
        ['session-1', 'request-2'],
      ]);
  });

  it('does not share success cache across client instances', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    const first = createLegacySandboxClient({ transport: host.value }).bind(context());
    const second = createLegacySandboxClient({ transport: host.value }).bind(context());

    await resolveArtifact(first);
    await resolveArtifact(second);
    await resolveArtifact(first);

    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
  });

  it('keeps the newer same-key result when concurrent reads finish out of order', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    let resolveOlder: ((content: string) => void) | undefined;
    let resolveNewer: ((content: string) => void) | undefined;
    host.readFile
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveOlder = resolve;
      }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveNewer = resolve;
      }));
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    const older = resolveArtifact(binding);
    const newer = resolveArtifact(binding);
    await vi.waitFor(() => expect(host.readFile).toHaveBeenCalledTimes(2));
    resolveNewer?.('name,value\nnewer,1\n');
    await expect(newer).resolves.toContain('newer');
    resolveOlder?.('name,value\nolder,1\n');
    await expect(older).resolves.toContain('older');

    await expect(resolveArtifact(binding)).resolves.toContain('newer');
    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
  });

  it('propagates abort reason during backoff and performs no later lookup', async () => {
    vi.useFakeTimers();
    const host = transport([]);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const controller = new AbortController();
    const reason = new Error('stop lookup');
    const promise = resolveArtifact(binding, 'chatbi_query_42', controller.signal);
    await vi.waitFor(() => expect(host.listFiles).toHaveBeenCalledOnce());

    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    await vi.runAllTimersAsync();
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.readFile).not.toHaveBeenCalled();
  });

  it('passes one signal through list/read and stops after an in-flight read abort', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    host.readFile.mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const controller = new AbortController();
    const reason = new Error('cancel read');
    const promise = resolveArtifact(binding, 'chatbi_query_42', controller.signal);
    await vi.waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());

    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.readFile).toHaveBeenCalledOnce();
    expect(host.listFiles.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
    expect(host.readFile.mock.calls[0]?.[0]?.signal).toBe(controller.signal);
  });

  it.each(['list', 'read'] as const)(
    'preserves a cross-realm AbortError identity from %s without retrying',
    async (operation) => {
      const selected = file('chatbi_query_42');
      const host = transport(operation === 'read' ? [selected] : []);
      const original = crossRealmAbortError();
      if (operation === 'list') host.listFiles.mockRejectedValue(original);
      else host.readFile.mockRejectedValue(original);
      const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
        phase: 'final',
      }));

      await expect(resolveArtifact(binding)).rejects.toBe(original);
      expect(host.listFiles).toHaveBeenCalledOnce();
      expect(host.readFile).toHaveBeenCalledTimes(operation === 'read' ? 1 : 0);
      expect(host.classifyError).not.toHaveBeenCalled();
    },
  );

  it('does not treat an arbitrary object named AbortError as a cancellation', async () => {
    const fakeAbort = {
      name: 'AbortError',
      message: 'untrusted payload',
      [Symbol.toStringTag]: 'Error',
    };
    const host = transport();
    host.listFiles.mockRejectedValue(fakeAbort);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    await expect(resolveArtifact(binding)).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_FATAL',
      cause: fakeAbort,
    });
    expect(host.listFiles).toHaveBeenCalledOnce();
    expect(host.classifyError).toHaveBeenCalledWith(fakeAbort, 'list');
  });

  it('rechecks abort after a successful stage and never caches canceled content', async () => {
    const selected = file('chatbi_query_42');
    const host = transport([selected]);
    let resolveRead: ((content: string) => void) | undefined;
    host.readFile
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveRead = resolve;
      }))
      .mockResolvedValueOnce(selected.content);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context({
      phase: 'final',
    }));
    const controller = new AbortController();
    const reason = new Error('abort after read resolution');
    const promise = resolveArtifact(binding, 'chatbi_query_42', controller.signal);
    await vi.waitFor(() => expect(host.readFile).toHaveBeenCalledOnce());

    resolveRead?.(selected.content);
    queueMicrotask(() => controller.abort(reason));
    await expect(promise).rejects.toBe(reason);

    await expect(resolveArtifact(binding)).resolves.toBe(selected.content);
    expect(host.listFiles).toHaveBeenCalledTimes(2);
    expect(host.readFile).toHaveBeenCalledTimes(2);
  });

  it('preserves a transport LegacySandboxError instead of reclassifying it', async () => {
    const original = new LegacySandboxError(
      'LEGACY_SANDBOX_FATAL',
      'authorized public failure',
      { cause: new Error('host cause') },
    );
    const host = transport();
    host.listFiles.mockRejectedValue(original);
    const binding = createLegacySandboxClient({ transport: host.value }).bind(context());

    await expect(resolveArtifact(binding)).rejects.toBe(original);
    expect(host.classifyError).not.toHaveBeenCalled();
  });
});
