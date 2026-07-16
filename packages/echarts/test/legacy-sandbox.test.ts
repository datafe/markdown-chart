// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import {
  executeLegacyChartSource,
  LEGACY_SANDBOX_CSP,
  LEGACY_SANDBOX_SRCDOC,
  LEGACY_SANDBOX_WORKER_SCRIPT,
} from '../src/legacy/sandbox';

interface ExecuteMessage {
  readonly channel: string;
  readonly type: string;
  readonly requestId: string;
  readonly source: string;
  readonly inputData: unknown;
}

function pendingExecution(
  signal = new AbortController().signal,
  timeoutMs = 5_000,
  source = 'var option = { series: [] };',
) {
  const promise = executeLegacyChartSource({
    source,
    inputData: [{ name: 'A', value: 10 }],
    signal,
    timeoutMs,
  });
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Temporary chart sandbox"]');
  if (!iframe?.contentWindow) throw new Error('sandbox iframe was not created');
  const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => undefined);
  const loadHandler = iframe.onload;
  loadHandler?.call(iframe, new Event('load'));
  const request = postMessage.mock.calls[0]?.[0] as ExecuteMessage | undefined;
  if (!request) throw new Error('sandbox execute message was not posted');
  return { promise, iframe, request, postMessage, loadHandler };
}

function reply(
  iframe: HTMLIFrameElement,
  request: ExecuteMessage,
  data: Record<string, unknown>,
  source: MessageEventSource | null = iframe.contentWindow,
): void {
  window.dispatchEvent(new MessageEvent('message', {
    source,
    data: {
      channel: request.channel,
      requestId: request.requestId,
      ...data,
    },
  }));
}

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

describe('temporary unique-origin iframe and worker sandbox', () => {
  it('uses a trusted Worker bootstrap and an inline deny-by-default CSP', () => {
    const { promise, iframe, request } = pendingExecution();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe.srcdoc).toBe(LEGACY_SANDBOX_SRCDOC);
    expect(LEGACY_SANDBOX_CSP).toContain("default-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain("connect-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain("frame-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain('worker-src blob:');
    expect(LEGACY_SANDBOX_SRCDOC).toContain('new Worker(blobUrl)');
    expect(LEGACY_SANDBOX_SRCDOC).toContain('new MessageChannel()');
    expect(LEGACY_SANDBOX_SRCDOC).not.toContain(request.source);
    reply(iframe, request, { type: 'result', option: { series: [] } });
    return expect(promise).resolves.toEqual({ series: [] });
  });

  it('posts the secret-bearing request only once even if the first load handler runs again', () => {
    const secret = 'csv-secret-sentinel';
    const execution = pendingExecution(
      new AbortController().signal,
      5_000,
      `throw new Error(${JSON.stringify(secret)})`,
    );
    expect(LEGACY_SANDBOX_SRCDOC).not.toContain(secret);
    execution.loadHandler?.call(execution.iframe, new Event('load'));
    expect(execution.postMessage).toHaveBeenCalledOnce();
    expect(execution.iframe.onload).toBeNull();
    reply(execution.iframe, execution.request, { type: 'result', option: { series: [] } });
    return expect(execution.promise).resolves.toEqual({ series: [] });
  });

  it('requires both the target contentWindow and the unpredictable request id', async () => {
    const { promise, iframe, request } = pendingExecution();
    let settled = false;
    void promise.then(() => { settled = true; });

    reply(iframe, request, { type: 'result', option: { title: { text: 'wrong source' } } }, window);
    reply(iframe, { ...request, requestId: 'forged' }, {
      type: 'result', option: { title: { text: 'wrong id' } },
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(request.requestId).toMatch(/^[0-9a-f]{32}$/);

    reply(iframe, request, { type: 'result', option: { series: [{ type: 'bar' }] } });
    await expect(promise).resolves.toEqual({ series: [{ type: 'bar' }] });
    expect(iframe.isConnected).toBe(false);
  });

  it('uses fixed script errors without disclosing source-controlled details', async () => {
    const secret = 'artifact-content-secret-sentinel';
    const failed = pendingExecution(
      new AbortController().signal,
      5_000,
      `throw new Error(JSON.stringify(inputData) + ${JSON.stringify(secret)})`,
    );
    reply(failed.iframe, failed.request, {
      type: 'error',
      code: 'EXECUTION_FAILED',
      error: secret,
      stack: secret,
    });
    const error = await failed.promise.catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: 'LEGACY_SANDBOX_EXECUTION_FAILED',
    });
    expect(String(error)).not.toContain(secret);
    expect(failed.iframe.isConnected).toBe(false);

    const serializedProtocol = JSON.stringify({
      type: 'error',
      code: 'EXECUTION_FAILED',
    });
    expect(serializedProtocol).not.toContain(secret);
  });

  it('returns a fixed worker error for explicit throws and throwing toJSON hooks', () => {
    const secret = 'worker-secret-sentinel';
    const responses: unknown[] = [];
    class TestMessagePort {
      postMessage(value: unknown): void {
        responses.push(value);
      }

      close(): void {}
    }
    const execute = (source: string): unknown => {
      const context = vm.createContext({
        MessagePort: TestMessagePort,
        fetch() {},
        XMLHttpRequest: class {},
        WebSocket: class {},
        EventSource: class {},
        Worker: class {},
        SharedWorker: class {},
        navigator: { sendBeacon() {} },
      });
      vm.runInContext(LEGACY_SANDBOX_WORKER_SCRIPT, context);
      const port = new TestMessagePort();
      (context.onmessage as (event: unknown) => void)({
        data: {
          type: 'execute',
          source,
          inputData: [{ secret }],
        },
        ports: [port],
      });
      return responses.at(-1);
    };

    expect(execute('throw new Error(JSON.stringify(inputData))')).toEqual({
      type: 'error',
      code: 'EXECUTION_FAILED',
    });
    expect(execute(`var option = { toJSON: function () { throw new Error(${JSON.stringify(secret)}); } };`))
      .toEqual({ type: 'error', code: 'EXECUTION_FAILED' });
    expect(JSON.stringify(responses)).not.toContain(secret);
  });

  it('rejects non-JSON-object results and cleans up the iframe', async () => {

    const invalid = pendingExecution();
    reply(invalid.iframe, invalid.request, { type: 'result', option: [] });
    await expect(invalid.promise).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(invalid.iframe.isConnected).toBe(false);
  });

  it('handles abort, timeout, and iframe load errors with full DOM cleanup', async () => {
    const controller = new AbortController();
    const aborted = pendingExecution(controller.signal);
    controller.abort();
    await expect(aborted.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted.iframe.isConnected).toBe(false);

    vi.useFakeTimers();
    const timedOut = pendingExecution(new AbortController().signal, 25);
    const timeoutAssertion = expect(timedOut.promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timedOut.iframe.isConnected).toBe(false);
    vi.useRealTimers();

    const loadFailed = pendingExecution();
    loadFailed.iframe.onerror?.(new Event('error'));
    await expect(loadFailed.promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_EXECUTION_FAILED',
    });
    expect(loadFailed.iframe.isConnected).toBe(false);
  });
});
