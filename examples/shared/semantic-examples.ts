import waterfallZh from './waterfall-zh.json';
import waterfallEn from './waterfall-en.json';
import kpiZh from './kpi-zh.json';
import kpiEn from './kpi-en.json';

const fence = (chart: unknown): string => `\`\`\`markdown-chart\n${JSON.stringify(chart, null, 2)}\n\`\`\``;

export const semanticExamples = [
  '## 中文 · 红涨绿跌（示例数据）',
  '期初 100，经 +40、−180、+70 后期末为 30；小计 −40 是余额快照。',
  fence(kpiZh),
  fence(waterfallZh),
  '## English · Green up, red down (sample data)',
  'Opening 100 becomes 30 after +40, −180 and +70. The −40 subtotal is a balance snapshot.',
  fence(kpiEn),
  fence(waterfallEn),
].join('\n\n');
