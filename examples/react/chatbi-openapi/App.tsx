import { useMemo } from 'react';
import { MarkdownChart } from '@datafe/markdown-chart-react';
import { createChatBIArtifactContentResolver } from './data';

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
  const resolveLegacyArtifactContent = useMemo(
    () => createChatBIArtifactContentResolver({
      sessionId,
      ...(requestId ? { requestId } : {}),
    }),
    [sessionId, requestId],
  );

  return (
    <MarkdownChart
      source={markdown}
      streaming={streaming}
      resolveLegacyArtifactContent={resolveLegacyArtifactContent}
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
