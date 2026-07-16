import { useMemo } from 'react';
import { MarkdownChart } from '@datafe/markdown-chart-react';
import {
  createChatBIArtifactDataRefResolver,
  createChatBILegacyResolver,
  createExecuteChartSource,
} from './data';

export interface ChatBIChartMessageProps {
  readonly markdown: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly streaming?: boolean;
}

export function ChatBIChartMessage({
  markdown,
  sessionId,
  requestId,
  streaming = false,
}: ChatBIChartMessageProps) {
  const resolveDataRef = useMemo(
    () => createChatBIArtifactDataRefResolver({
      sessionId,
      ...(requestId ? { requestId } : {}),
    }),
    [sessionId, requestId],
  );
  const resolveLegacyEChartQuery = useMemo(
    () => createChatBILegacyResolver({
      resolveDataRef,
      executeChartSource: createExecuteChartSource(),
    }),
    [resolveDataRef],
  );
  const echarts = useMemo(() => ({ resolveDataRef }), [resolveDataRef]);

  return (
    <MarkdownChart
      source={markdown}
      streaming={streaming}
      echarts={echarts}
      resolveLegacyEChartQuery={resolveLegacyEChartQuery}
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
      />
    </main>
  );
}
