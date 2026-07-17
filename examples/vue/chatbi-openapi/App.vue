<script setup lang="ts">
import ChatBIChartMessage from './ChatBIChartMessage.vue';

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
</script>

<template>
  <main>
    <ChatBIChartMessage
      :markdown="mockStreamedMarkdown"
      session-id="replace-with-session-id"
      request-id="replace-with-current-request-id"
    />
  </main>
</template>
