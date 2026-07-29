import {
  MarkdownChartError,
  isJsonObject,
  validateChartJsonValue,
  type ChartDataRow,
  type JsonValue,
} from '@datafe-open/markdown-chart';

const SANDBOX_CHANNEL = '@datafe-open/markdown-chart/legacy-echart-query';

export const LEGACY_SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "worker-src blob:",
  "connect-src 'none'",
  "img-src 'none'",
  "style-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Trusted worker bootstrap. The legacy source is delivered later by message. */
export const LEGACY_SANDBOX_WORKER_SCRIPT = `
(function () {
  'use strict';
  var handled = false;

  function disableGlobal(name) {
    try {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        writable: false,
        configurable: false
      });
    } catch (_) {
      try { globalThis[name] = undefined; } catch (_) {}
    }
  }

  globalThis.onmessage = function (event) {
    if (handled) return;
    handled = true;
    var request = event.data;
    var port = event.ports && event.ports[0];
    if (!request || request.type !== 'execute' || typeof request.source !== 'string' || !port) {
      return;
    }

    var stringify = JSON.stringify.bind(JSON);
    var parse = JSON.parse.bind(JSON);
    var send;
    try {
      send = MessagePort.prototype.postMessage.bind(port);
      Object.defineProperty(globalThis, 'inputData', {
        value: request.inputData,
        writable: false,
        configurable: false
      });
      [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'WebSocketStream',
        'EventSource',
        'WebTransport',
        'importScripts',
        'Worker',
        'SharedWorker',
        'postMessage',
        'close'
      ].forEach(disableGlobal);
      try {
        if (globalThis.navigator) {
          Object.defineProperty(globalThis.navigator, 'sendBeacon', {
            value: undefined,
            writable: false,
            configurable: false
          });
        }
      } catch (_) {}

      var option = (0, eval)(request.source + '\\n;typeof option === "undefined" ? undefined : option;');
      var serialized = stringify(option);
      if (serialized === undefined) throw new Error('missing option');
      send({ type: 'result', option: parse(serialized) });
    } catch (_) {
      try {
        if (send) send({ type: 'error', code: 'EXECUTION_FAILED' });
      } catch (_) {}
    } finally {
      try { port.close(); } catch (_) {}
    }
  };
})();`;

function scriptLiteral(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function createSandboxScript(expectedRequestId: string): string {
  return `
(function () {
  'use strict';
  var CHANNEL = ${scriptLiteral(SANDBOX_CHANNEL)};
  var WORKER_SCRIPT = ${scriptLiteral(LEGACY_SANDBOX_WORKER_SCRIPT)};
  var EXPECTED_REQUEST_ID = ${scriptLiteral(expectedRequestId)};
  var handled = false;
  var activeWorker;

  function closePort(port) {
    if (!port) return;
    try { port.close(); } catch (_) {}
  }

  window.addEventListener('message', function (event) {
    var request = event.data;
    var replyPort = event.ports && event.ports[0];
    if (
      handled
      || !replyPort
      || !request
      || request.channel !== CHANNEL
      || request.type !== 'execute'
      || request.requestId !== EXPECTED_REQUEST_ID
      || typeof request.source !== 'string'
    ) {
      closePort(replyPort);
      return;
    }
    handled = true;

    var blobUrl;
    var port1;
    var done = false;
    var send = MessagePort.prototype.postMessage.bind(replyPort);
    function cleanup() {
      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = undefined;
      }
      if (port1) {
        port1.onmessage = null;
        try { port1.close(); } catch (_) {}
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = undefined;
      }
    }
    function settle(payload) {
      if (done) return;
      done = true;
      cleanup();
      try { send(payload); } catch (_) {}
      closePort(replyPort);
    }

    try {
      blobUrl = URL.createObjectURL(new Blob([WORKER_SCRIPT], { type: 'text/javascript' }));
      activeWorker = new Worker(blobUrl);
      URL.revokeObjectURL(blobUrl);
      blobUrl = undefined;
      var messageChannel = new MessageChannel();
      port1 = messageChannel.port1;
      port1.onmessage = function (workerEvent) {
        var response = workerEvent.data;
        if (response && response.type === 'result') {
          settle({
            channel: CHANNEL,
            type: 'result',
            requestId: request.requestId,
            option: response.option
          });
          return;
        }
        settle({
          channel: CHANNEL,
          type: 'error',
          requestId: request.requestId,
          code: 'EXECUTION_FAILED'
        });
      };
      activeWorker.onerror = function (workerError) {
        workerError.preventDefault();
        settle({
          channel: CHANNEL,
          type: 'error',
          requestId: request.requestId,
          code: 'EXECUTION_FAILED'
        });
      };
      activeWorker.postMessage({
        type: 'execute',
        source: request.source,
        inputData: request.inputData
      }, [messageChannel.port2]);
    } catch (_) {
      settle({
        channel: CHANNEL,
        type: 'error',
        requestId: request.requestId,
        code: 'EXECUTION_FAILED'
      });
    }
  });
})();`;
}

function createLegacySandboxSrcdoc(expectedRequestId: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${LEGACY_SANDBOX_CSP}"></head>
<body><script>${createSandboxScript(expectedRequestId)}<\/script></body></html>`;
}

export interface ExecuteLegacyChartSourceRequest {
  readonly source: string;
  readonly inputData: readonly ChartDataRow[];
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

function createRequestId(): string {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new MarkdownChartError(
      'LEGACY_SANDBOX_UNAVAILABLE',
      'Secure random values are required by the temporary legacy sandbox',
    );
  }
  const values = new Uint32Array(4);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
}

function abortedError(): DOMException {
  return new DOMException('The temporary legacy chart operation was aborted', 'AbortError');
}

/**
 * @deprecated Executes temporary ChatBI source in a dedicated Worker owned by
 * a unique-origin iframe. Removing the iframe terminates a non-responsive worker.
 */
export function executeLegacyChartSource(
  request: ExecuteLegacyChartSourceRequest,
): Promise<Record<string, JsonValue>> {
  if (request.signal.aborted) {
    return Promise.reject(abortedError());
  }
  if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0) {
    return Promise.reject(new MarkdownChartError(
      'SCHEMA_INVALID',
      'Legacy sandbox timeout must be a positive safe integer',
    ));
  }
  if (typeof document === 'undefined' || !document.body) {
    return Promise.reject(new MarkdownChartError(
      'LEGACY_SANDBOX_UNAVAILABLE',
      'The temporary legacy sandbox requires a browser document body',
    ));
  }

  const requestId = createRequestId();
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'Temporary chart sandbox');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = createLegacySandboxSrcdoc(requestId);

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();
    const responsePort = messageChannel.port1;
    const requestPort = messageChannel.port2;
    let settled = false;
    let loaded = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      responsePort.onmessage = null;
      responsePort.onmessageerror = null;
      try {
        responsePort.close();
      } catch {}
      try {
        requestPort.close();
      } catch {}
      request.signal.removeEventListener('abort', onAbort);
      iframe.onload = null;
      iframe.onerror = null;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      iframe.remove();
    };
    const finish = (
      callback: (value: Record<string, JsonValue>) => void,
      value: Record<string, JsonValue>,
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = (): void => fail(abortedError());
    const onMessage = (event: MessageEvent): void => {
      if (!isJsonObject(event.data)) {
        return;
      }
      if (
        event.data.channel !== SANDBOX_CHANNEL
        || event.data.requestId !== requestId
      ) {
        return;
      }
      if (event.data.type === 'error') {
        fail(new MarkdownChartError(
          'LEGACY_SANDBOX_EXECUTION_FAILED',
          'Temporary legacy chart source failed in the isolated worker',
        ));
        return;
      }
      if (event.data.type !== 'result') {
        return;
      }
      try {
        const option = validateChartJsonValue(event.data.option);
        if (!isJsonObject(option)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            'Temporary legacy chart source must produce a JSON object option',
          );
        }
        finish(resolve, option);
      } catch (cause) {
        fail(cause);
      }
    };

    responsePort.onmessage = onMessage;
    responsePort.onmessageerror = () => fail(new MarkdownChartError(
      'LEGACY_SANDBOX_EXECUTION_FAILED',
      'Temporary legacy chart sandbox returned an unreadable response',
    ));
    request.signal.addEventListener('abort', onAbort, { once: true });
    iframe.onerror = () => fail(new MarkdownChartError(
      'LEGACY_SANDBOX_EXECUTION_FAILED',
      'Temporary legacy chart sandbox failed to load',
    ));
    iframe.onload = () => {
      if (loaded) return;
      loaded = true;
      iframe.onload = null;
      if (settled || request.signal.aborted) {
        onAbort();
        return;
      }
      try {
        iframe.contentWindow?.postMessage({
          channel: SANDBOX_CHANNEL,
          type: 'execute',
          requestId,
          source: request.source,
          inputData: request.inputData,
        }, '*', [requestPort]);
      } catch {
        fail(new MarkdownChartError(
          'LEGACY_SANDBOX_EXECUTION_FAILED',
          'Temporary legacy chart sandbox failed to initialize',
        ));
      }
    };
    timeout = setTimeout(() => fail(new MarkdownChartError(
      'LEGACY_SANDBOX_TIMEOUT',
      `Temporary legacy chart sandbox exceeded ${request.timeoutMs}ms`,
    )), request.timeoutMs);
    document.body.append(iframe);
  });
}
