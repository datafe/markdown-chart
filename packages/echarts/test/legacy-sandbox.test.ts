// @vitest-environment jsdom
import {
  MessageChannel as NodeMessageChannel,
  MessagePort as NodeMessagePort,
} from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import {
  executeLegacyChartSource,
  LEGACY_SANDBOX_CSP,
  LEGACY_SANDBOX_WORKER_SCRIPT,
} from '../src/legacy/sandbox';

interface ExecuteMessage {
  readonly channel: string;
  readonly type: string;
  readonly requestId: string;
  readonly source: string;
  readonly inputData: unknown;
}

interface TrackedMessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
}

let trackedMessageChannels: TrackedMessageChannel[] = [];

class BrowserMessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;

  constructor() {
    const channel = new NodeMessageChannel();
    this.port1 = channel.port1 as unknown as MessagePort;
    this.port2 = channel.port2 as unknown as MessagePort;
    trackedMessageChannels.push(this);
  }
}

function pendingExecution(
  signal = new AbortController().signal,
  timeoutMs = 5_000,
  source = 'var option = { series: [] };',
  postMessageError?: unknown,
) {
  const promise = executeLegacyChartSource({
    source,
    inputData: [{ name: 'A', value: 10 }],
    signal,
    timeoutMs,
  });
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Temporary chart sandbox"]');
  if (!iframe?.contentWindow) throw new Error('sandbox iframe was not created');
  const postMessage = vi.spyOn(iframe.contentWindow, 'postMessage').mockImplementation(() => {
    if (postMessageError !== undefined) throw postMessageError;
  });
  const messageChannel = trackedMessageChannels.at(-1);
  if (!messageChannel) throw new Error('sandbox message channel was not created');
  const responsePortClose = vi.spyOn(messageChannel.port1, 'close');
  const requestPortClose = vi.spyOn(messageChannel.port2, 'close');
  const loadHandler = iframe.onload;
  loadHandler?.call(iframe, new Event('load'));
  const postMessageCalls = postMessage.mock.calls as unknown as [
    ExecuteMessage,
    string,
    Transferable[],
  ][];
  const request = postMessageCalls[0]?.[0];
  if (!request) throw new Error('sandbox execute message was not posted');
  const transfer = postMessageCalls[0]?.[2];
  return {
    promise,
    iframe,
    request,
    postMessage,
    loadHandler,
    responsePort: messageChannel.port1,
    replyPort: messageChannel.port2,
    responsePortClose,
    requestPortClose,
    transfer,
  };
}

function reply(
  port: MessagePort,
  request: ExecuteMessage,
  data: Record<string, unknown>,
): void {
  port.postMessage({
    channel: request.channel,
    requestId: request.requestId,
    ...data,
  });
}

function getSandboxScript(srcdoc: string): string {
  const match = /<body><script>([\s\S]*)<\/script><\/body>/.exec(srcdoc);
  if (!match?.[1]) throw new Error('sandbox bootstrap script was not found');
  return match[1];
}

function createSandboxBootstrapHarness(srcdoc: string) {
  let onMessage: ((event: {
    readonly data: unknown;
    readonly ports?: readonly NodeMessagePort[];
    readonly source?: unknown;
  }) => void) | undefined;
  const parentPostMessage = vi.fn();
  const parentWindow = { postMessage: parentPostMessage };
  const workers: TestWorker[] = [];

  class TestWorker {
    onerror: ((error: { preventDefault(): void }) => void) | null = null;
    readonly terminate = vi.fn();

    constructor(_url: string) {
      workers.push(this);
    }

    postMessage(
      _request: unknown,
      ports: readonly NodeMessagePort[],
    ): void {
      ports[0]?.postMessage({
        type: 'result',
        option: { series: [{ type: 'pie' }] },
      });
      ports[0]?.close();
    }
  }

  const context = vm.createContext({
    Blob,
    MessageChannel: NodeMessageChannel,
    MessagePort: NodeMessagePort,
    URL: {
      createObjectURL: vi.fn(() => 'blob:test-worker'),
      revokeObjectURL: vi.fn(),
    },
    Worker: TestWorker,
    parent: parentWindow,
    window: {
      addEventListener(
        type: string,
        listener: typeof onMessage,
      ): void {
        if (type === 'message') onMessage = listener;
      },
    },
  });
  vm.runInContext(getSandboxScript(srcdoc), context);
  if (!onMessage) throw new Error('sandbox message listener was not registered');
  return { dispatch: onMessage, parentPostMessage, parentWindow, workers };
}

function nextPortMessage(port: NodeMessagePort): Promise<unknown> {
  return new Promise((resolve) => {
    port.once('message', resolve);
    port.start();
  });
}

beforeEach(() => {
  trackedMessageChannels = [];
  vi.stubGlobal('MessageChannel', BrowserMessageChannel);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

describe('temporary unique-origin iframe and worker sandbox', () => {
  it('uses a trusted Worker bootstrap and an inline deny-by-default CSP', () => {
    const execution = pendingExecution();
    expect(execution.iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(execution.iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(LEGACY_SANDBOX_CSP).toContain("default-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain("connect-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain("frame-src 'none'");
    expect(LEGACY_SANDBOX_CSP).toContain('worker-src blob:');
    expect(execution.iframe.srcdoc).toContain('new Worker(blobUrl)');
    expect(execution.iframe.srcdoc).toContain('new MessageChannel()');
    expect(execution.iframe.srcdoc).not.toContain('event.source !== parent');
    expect(execution.iframe.srcdoc).not.toContain('parent.postMessage');
    expect(execution.iframe.srcdoc).toContain(execution.request.requestId);
    expect(execution.iframe.srcdoc).not.toContain(execution.request.source);
    reply(execution.replyPort, execution.request, { type: 'result', option: { series: [] } });
    return expect(execution.promise).resolves.toEqual({ series: [] });
  });

  it('rejects a wrong valid id without consuming the split-window request', async () => {
    const execution = pendingExecution();
    const harness = createSandboxBootstrapHarness(execution.iframe.srcdoc);
    const invalidChannel = new NodeMessageChannel();
    const invalidReplyPortClosed = new Promise<void>((resolve) => {
      invalidChannel.port2.once('close', resolve);
    });
    const wrongRequestId = execution.request.requestId === '0'.repeat(32)
      ? '1'.repeat(32)
      : '0'.repeat(32);

    harness.dispatch({
      source: {},
      data: {
        channel: execution.request.channel,
        type: 'execute',
        requestId: wrongRequestId,
        source: 'var option = { title: { text: "attacker" } };',
        inputData: [],
      },
      ports: [invalidChannel.port2],
    });
    await invalidReplyPortClosed;
    expect(harness.workers).toHaveLength(0);

    const responseChannel = new NodeMessageChannel();
    const response = nextPortMessage(responseChannel.port1);
    const replyPortClosed = new Promise<void>((resolve) => {
      responseChannel.port2.once('close', resolve);
    });
    const senderWindow = {};

    harness.dispatch({
      source: senderWindow,
      data: {
        channel: execution.request.channel,
        type: 'execute',
        requestId: execution.request.requestId,
        source: 'var option = { series: [{ type: "pie" }] };',
        inputData: [{ name: 'A', value: 10 }],
      },
      ports: [responseChannel.port2],
    });

    await expect(response).resolves.toEqual({
      channel: execution.request.channel,
      type: 'result',
      requestId: execution.request.requestId,
      option: { series: [{ type: 'pie' }] },
    });
    await replyPortClosed;
    expect(senderWindow).not.toBe(harness.parentWindow);
    expect(harness.parentPostMessage).not.toHaveBeenCalled();
    expect(harness.workers).toHaveLength(1);
    expect(harness.workers[0]?.terminate).toHaveBeenCalledOnce();
    invalidChannel.port1.close();
    responseChannel.port1.close();
    reply(execution.replyPort, execution.request, { type: 'result', option: { series: [] } });
    await expect(execution.promise).resolves.toEqual({ series: [] });
  });

  it('ignores bootstrap requests without a port or a well-formed request', async () => {
    const execution = pendingExecution();
    const harness = createSandboxBootstrapHarness(execution.iframe.srcdoc);
    const invalidChannel = new NodeMessageChannel();
    const validChannel = new NodeMessageChannel();
    const invalidReplyPortClosed = new Promise<void>((resolve) => {
      invalidChannel.port2.once('close', resolve);
    });

    harness.dispatch({
      data: {
        channel: execution.request.channel,
        type: 'execute',
        requestId: execution.request.requestId,
        source: 'var option = {};',
      },
      ports: [],
    });
    harness.dispatch({
      data: {
        channel: execution.request.channel,
        type: 'execute',
        requestId: 'forged',
        source: 'var option = {};',
      },
      ports: [invalidChannel.port2],
    });
    await invalidReplyPortClosed;
    expect(harness.workers).toHaveLength(0);

    const response = nextPortMessage(validChannel.port1);
    harness.dispatch({
      source: {},
      data: {
        channel: execution.request.channel,
        type: 'execute',
        requestId: execution.request.requestId,
        source: 'var option = { series: [] };',
      },
      ports: [validChannel.port2],
    });
    await expect(response).resolves.toMatchObject({
      type: 'result',
      requestId: execution.request.requestId,
    });
    expect(harness.workers).toHaveLength(1);
    invalidChannel.port1.close();
    validChannel.port1.close();
    reply(execution.replyPort, execution.request, { type: 'result', option: { series: [] } });
    await expect(execution.promise).resolves.toEqual({ series: [] });
  });

  it('posts the secret-bearing request only once even if the first load handler runs again', () => {
    const secret = 'csv-secret-sentinel';
    const execution = pendingExecution(
      new AbortController().signal,
      5_000,
      `throw new Error(${JSON.stringify(secret)})`,
    );
    expect(execution.iframe.srcdoc).not.toContain(secret);
    execution.loadHandler?.call(execution.iframe, new Event('load'));
    expect(execution.postMessage).toHaveBeenCalledOnce();
    expect(execution.iframe.onload).toBeNull();
    expect(execution.transfer).toEqual([execution.replyPort]);
    reply(execution.replyPort, execution.request, { type: 'result', option: { series: [] } });
    return expect(execution.promise).resolves.toEqual({ series: [] });
  });

  it('accepts responses only on the dedicated port with the unpredictable request id', async () => {
    const execution = pendingExecution();
    let settled = false;
    void execution.promise.then(() => { settled = true; });

    window.dispatchEvent(new MessageEvent('message', {
      source: execution.iframe.contentWindow,
      data: {
        channel: execution.request.channel,
        requestId: execution.request.requestId,
        type: 'result',
        option: { title: { text: 'global response' } },
      },
    }));
    reply(execution.replyPort, { ...execution.request, requestId: 'forged' }, {
      type: 'result', option: { title: { text: 'wrong id' } },
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execution.request.requestId).toMatch(/^[0-9a-f]{32}$/);

    reply(execution.replyPort, execution.request, {
      type: 'result',
      option: { series: [{ type: 'bar' }] },
    });
    await expect(execution.promise).resolves.toEqual({ series: [{ type: 'bar' }] });
    expect(execution.iframe.isConnected).toBe(false);
    expect(execution.responsePortClose).toHaveBeenCalledOnce();
    expect(execution.requestPortClose).toHaveBeenCalledOnce();
  });

  it('uses fixed script errors without disclosing source-controlled details', async () => {
    const secret = 'artifact-content-secret-sentinel';
    const failed = pendingExecution(
      new AbortController().signal,
      5_000,
      `throw new Error(JSON.stringify(inputData) + ${JSON.stringify(secret)})`,
    );
    reply(failed.replyPort, failed.request, {
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
    reply(invalid.replyPort, invalid.request, { type: 'result', option: [] });
    await expect(invalid.promise).rejects.toMatchObject({ code: 'SCHEMA_INVALID' });
    expect(invalid.iframe.isConnected).toBe(false);
  });

  it('handles abort, timeout, and iframe load errors with full DOM cleanup', async () => {
    const controller = new AbortController();
    const aborted = pendingExecution(controller.signal);
    controller.abort();
    await expect(aborted.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted.iframe.isConnected).toBe(false);
    expect(aborted.responsePortClose).toHaveBeenCalledOnce();
    expect(aborted.requestPortClose).toHaveBeenCalledOnce();

    vi.useFakeTimers();
    const timedOut = pendingExecution(new AbortController().signal, 25);
    const timeoutAssertion = expect(timedOut.promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(timedOut.iframe.isConnected).toBe(false);
    expect(timedOut.responsePortClose).toHaveBeenCalledOnce();
    expect(timedOut.requestPortClose).toHaveBeenCalledOnce();
    vi.useRealTimers();

    const loadFailed = pendingExecution();
    loadFailed.iframe.onerror?.(new Event('error'));
    await expect(loadFailed.promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_EXECUTION_FAILED',
    });
    expect(loadFailed.iframe.isConnected).toBe(false);
    expect(loadFailed.responsePortClose).toHaveBeenCalledOnce();
    expect(loadFailed.requestPortClose).toHaveBeenCalledOnce();
  });

  it('maps a synchronous postMessage failure and closes both channel ports', async () => {
    const failed = pendingExecution(
      new AbortController().signal,
      5_000,
      'var option = { series: [] };',
      new DOMException('transfer failed', 'DataCloneError'),
    );

    await expect(failed.promise).rejects.toMatchObject({
      code: 'LEGACY_SANDBOX_EXECUTION_FAILED',
    });
    expect(failed.iframe.isConnected).toBe(false);
    expect(failed.responsePortClose).toHaveBeenCalledOnce();
    expect(failed.requestPortClose).toHaveBeenCalledOnce();
  });
});
