import { useMemo } from 'react';
import { MarkdownChart } from '@datafe-open/markdown-chart-react';
import {
  createLegacySandboxHostAdapter,
  type LegacySandboxHostContext,
} from '@datafe-open/markdown-chart-echarts';
import { createChatBILegacySandboxTransport } from './data';

export interface ChatBIChartMessageProps {
  readonly markdown: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly streaming?: boolean;
  readonly cacheScopeKey: string;
}

interface DeferredLegacyMarkdown {
  readonly source: string;
  readonly deferredCount: number;
}

interface FenceOpening {
  readonly character: '`' | '~';
  readonly length: number;
  readonly language: string;
  readonly quoteDepth: number;
  readonly listContinuationIndent?: number;
  readonly pendingPrefix: string;
}

function splitQuotePrefix(line: string): {
  readonly prefix: string;
  readonly content: string;
  readonly quoteDepth: number;
} {
  const match = /^((?: {0,3}>[ \t]?)*)(.*)$/.exec(line);
  const prefix = match?.[1] ?? '';
  return {
    prefix,
    content: match?.[2] ?? line,
    quoteDepth: Array.from(prefix).filter((character) => character === '>').length,
  };
}

function parseFenceOpening(line: string): FenceOpening | undefined {
  const { prefix: quotePrefix, content, quoteDepth } = splitQuotePrefix(line);
  const indentMatch = /^( {0,3})(.*)$/.exec(content);
  const outerIndent = indentMatch?.[1] ?? '';
  const body = indentMatch?.[2] ?? content;
  const listMatch = /^((?:[-+*]|[0-9]{1,9}[.)]) {1,4})(.*)$/.exec(body);
  const fenceContent = listMatch?.[2] ?? body;
  const marker = fenceContent[0];
  if (marker !== '`' && marker !== '~') return undefined;
  let length = 0;
  while (fenceContent[length] === marker) length += 1;
  if (length < 3) return undefined;
  const info = fenceContent.slice(length).trim();
  if (marker === '`' && info.includes('`')) return undefined;
  const listPrefix = listMatch?.[1];
  return {
    character: marker,
    length,
    language: info.split(/\s+/, 1)[0] ?? '',
    quoteDepth,
    ...(listPrefix
      ? { listContinuationIndent: outerIndent.length + listPrefix.length }
      : {}),
    pendingPrefix: listPrefix
      ? `${quotePrefix}${outerIndent}${listPrefix}`
      : quoteDepth > 0
        ? `${quotePrefix}${outerIndent}`
        : `${outerIndent}> `,
  };
}

function isFenceClosing(line: string, opening: FenceOpening): boolean {
  const { content, quoteDepth } = splitQuotePrefix(line);
  if (quoteDepth !== opening.quoteDepth) return false;
  let fenceContent = content;
  if (opening.listContinuationIndent !== undefined) {
    const continuation = ' '.repeat(opening.listContinuationIndent);
    if (!fenceContent.startsWith(continuation)) return false;
    fenceContent = fenceContent.slice(continuation.length);
  }
  fenceContent = fenceContent.replace(/^ {0,3}/, '');
  if (fenceContent[0] !== opening.character) return false;
  let length = 0;
  while (fenceContent[length] === opening.character) length += 1;
  return length >= opening.length && fenceContent.slice(length).trim() === '';
}

function replaceDeferredLegacyFences(
  markdown: string,
  shouldDefer: (language: string) => boolean,
): DeferredLegacyMarkdown {
  const lines = markdown.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  let source = '';
  let deferredCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.endsWith('\n') ? rawLine.slice(0, -1).replace(/\r$/, '') : rawLine;
    const opening = parseFenceOpening(line);
    if (!opening) {
      source += rawLine;
      continue;
    }

    let closingIndex = index + 1;
    while (closingIndex < lines.length) {
      const rawClosingLine = lines[closingIndex] ?? '';
      const closingLine = rawClosingLine.endsWith('\n')
        ? rawClosingLine.slice(0, -1).replace(/\r$/, '')
        : rawClosingLine;
      if (isFenceClosing(closingLine, opening)) break;
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) {
      source += lines.slice(index).join('');
      break;
    }

    if (!opening.language || !shouldDefer(opening.language.toLowerCase())) {
      source += lines.slice(index, closingIndex + 1).join('');
      index = closingIndex;
      continue;
    }

    const closingLine = lines[closingIndex] ?? '';
    const newline = closingLine.endsWith('\n') ? '\n' : '';
    source += `${opening.pendingPrefix}**Chart data is still being prepared.**${newline}`;
    deferredCount += 1;
    index = closingIndex;
  }

  return { source, deferredCount };
}

export function ChatBIChartMessage({
  markdown,
  sessionId,
  requestId,
  streaming = false,
  cacheScopeKey,
}: ChatBIChartMessageProps) {
  const transport = useMemo(() => createChatBILegacySandboxTransport(), []);
  const hostAdapter = useMemo(
    () => createLegacySandboxHostAdapter({ transport }),
    [transport],
  );
  const hostContext = useMemo<LegacySandboxHostContext>(() => ({
      sessionId,
      ...(requestId ? { requestId } : {}),
      phase: streaming ? 'live' : 'final',
      cacheScopeKey,
    }), [sessionId, requestId, streaming, cacheScopeKey]);
  const hostIdentity = hostAdapter.identity(hostContext);
  const legacySandbox = useMemo(() => {
    const binding = hostAdapter.bind(hostContext);
    if (!binding) throw new Error('sessionId and cacheScopeKey are required');
    return binding;
  }, [hostAdapter, hostIdentity]);
  const echarts = useMemo(() => ({ legacySandbox }), [legacySandbox]);
  const deferredMarkdown = useMemo(
    () => replaceDeferredLegacyFences(markdown, legacySandbox.shouldDefer),
    [markdown, legacySandbox],
  );

  return (
    <div
      aria-busy={deferredMarkdown.deferredCount > 0 || undefined}
      data-chatbi-legacy-chart-pending={
        deferredMarkdown.deferredCount > 0 ? 'true' : undefined
      }
    >
      <MarkdownChart
        source={deferredMarkdown.source}
        streaming={streaming}
        echarts={echarts}
      />
    </div>
  );
}

const mockStreamedMarkdown = `# Sales analysis

The following chart block is supplied by the ChatBI OpenAPI stream.

\`\`\`echarts-chatbi_query_8660210443288600709-0
var option = {
  xAxis: { type: 'category', data: inputData.map(row => row.category) },
  yAxis: {},
  series: [{ type: 'bar', data: inputData.map(row => row.value) }]
};
//#end
\`\`\``;

export function App() {
  return (
    <main>
      <ChatBIChartMessage
        markdown={mockStreamedMarkdown}
        sessionId="replace-with-session-id"
        requestId="replace-with-current-request-id"
        cacheScopeKey="replace-with-tenant-id:replace-with-user-id"
      />
    </main>
  );
}
