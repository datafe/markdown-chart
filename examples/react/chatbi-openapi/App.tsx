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
  readonly requestId: string;
  readonly streaming?: boolean;
  readonly cacheScopeKey: string;
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
    requestId,
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

  return (
    <MarkdownChart
      source={markdown}
      streaming={streaming}
      echarts={echarts}
    />
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
