import { useCallback, useMemo, useState } from 'react';
import type {
  ChartDataRow,
  ChartReferenceEvent,
  ResolvedChartData,
} from '@datafe-open/markdown-chart';
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

function createKnowledgeBaseIcon({ document: ownerDocument }: { document: Document }): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = ownerDocument.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '13');
  icon.setAttribute('height', '13');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.75');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  const book = ownerDocument.createElementNS(namespace, 'rect');
  book.setAttribute('width', '8');
  book.setAttribute('height', '18');
  book.setAttribute('x', '3');
  book.setAttribute('y', '3');
  book.setAttribute('rx', '1');
  const spine = ownerDocument.createElementNS(namespace, 'path');
  spine.setAttribute('d', 'M7 3v18');
  const leaningBook = ownerDocument.createElementNS(namespace, 'path');
  leaningBook.setAttribute('d', 'M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z');
  icon.append(book, spine, leaningBook);
  return icon;
}

const dimensions = [
  'day',
  'unmetDemand',
  'lostRevenueWan',
  'incrementalRevenue',
] as const;

const rows: readonly ChartDataRow[] = [
  ['08-27', 0.31, 510, 12_600_000],
  ['08-28', 0.33, 548, 13_400_000],
  ['08-29', 0.35, 590, 14_500_000],
  ['08-30', 0.36, 632, 15_700_000],
  ['08-31', 0.38, 681, 16_800_000],
  ['09-01', 0.4, 720, 18_000_000],
];

const inventoryDimensions = ['recordedAt', 'storeInventory', 'inventoryStatus', 'inventoryTone'] as const;
const inventoryRows: readonly ChartDataRow[] = [
  ['08-31 09:00', '24/48', '库存偏低', 'warning'],
  ['09-01 09:00', '23/48', '低于安全水位', 'negative'],
];

const spec = {
  timeField: 'day',
  items: [
    {
      id: 'unmet_demand',
      title: '未满足需求',
      value: {
        field: 'unmetDemand',
        reduce: 'lastNonNull',
        format: { style: 'percent', maximumFractionDigits: 0 },
      },
      status: { text: { literal: '流失中' }, tone: { literal: 'negative' } },
      trend: {
        type: 'area',
        compare: { lag: 1, mode: 'absolute', label: '较昨日', polarity: 'lower-is-better' },
        yScale: { includeZero: true },
      },
      references: [{ ref: 'wiki://metrics/unmet-demand', label: '未满足需求口径' }],
    },
    {
      id: 'lost_revenue',
      title: '累计流失营收',
      value: {
        field: 'lostRevenueWan',
        format: { style: 'decimal', maximumFractionDigits: 0, suffix: '万' },
      },
      status: { text: { literal: '持续扩大' }, tone: { literal: 'negative' } },
      trend: {
        type: 'line',
        compare: { lag: 1, mode: 'relative', label: '较昨日', polarity: 'lower-is-better' },
      },
      references: [{ ref: 'wiki://metrics/lost-revenue', label: '流失营收口径' }],
    },
    {
      id: 'incremental_revenue',
      title: '预估增量营收',
      value: {
        field: 'incrementalRevenue',
        format: {
          style: 'currency',
          currency: 'CNY',
          notation: 'compact',
          maximumFractionDigits: 1,
        },
      },
      trend: {
        type: 'area',
        compare: { lag: 1, mode: 'relative', label: '较昨日', polarity: 'higher-is-better' },
      },
      references: [{ ref: 'wiki://metrics/incremental-revenue', label: '增量营收预测方法' }],
    },
    {
      id: 'store_inventory',
      title: '门店库存',
      dataset: 'inventory',
      value: { field: 'storeInventory', format: { style: 'text' } },
      status: { text: { field: 'inventoryStatus' }, tone: { field: 'inventoryTone' } },
      references: [{ ref: 'wiki://metrics/store-inventory', label: '门店安全库存口径' }],
    },
  ],
};

const wikiContent: Record<string, { title: string; breadcrumb: string; body: string }> = {
  'wiki://metrics/unmet-demand': {
    title: '未满足需求率',
    breadcrumb: '经营分析 Wiki / 指标口径 / 供需',
    body: '未满足需求率 = 未满足订单量 ÷ 总需求量。当前卡片使用日粒度宽表的最后一个非空值。',
  },
  'wiki://metrics/lost-revenue': {
    title: '累计流失营收',
    breadcrumb: '经营分析 Wiki / 指标口径 / 营收',
    body: '统计周期内因未满足需求导致的预计流失营收，单位为万元。趋势比较严格按源数据行偏移计算。',
  },
  'wiki://metrics/incremental-revenue': {
    title: '增量营收预测方法',
    breadcrumb: '经营分析 Wiki / 预测模型 / 营收机会',
    body: '基于补货后可恢复订单量与商品价格估算。货币格式由安全的 Intl.NumberFormat 配置生成。',
  },
  'wiki://metrics/store-inventory': {
    title: '门店安全库存口径',
    breadcrumb: '经营分析 Wiki / 指标口径 / 库存',
    body: '分子表示低于安全库存线的门店数，分母表示纳入监控的门店总数。该指标不展示趋势。',
  },
};

const graphChart = {
  version: 1,
  renderer: 'echarts',
  data: {
    kind: 'inline',
    shape: 'graph',
    source: {
      nodes: [
        { id: 'entry', name: '首次进入且尚未选择分析路径的会话', category: '入口' },
        { id: 'analysis', name: '分析', category: '结果' },
        { id: 'artifact', name: '产物', category: '结果' },
      ],
      links: [
        { source: 'entry', target: 'analysis', value: 70 },
        { source: 'entry', target: 'artifact', value: 30 },
      ],
    },
  },
  spec: {
    title: { text: '会话流向（示例数据）' },
    tooltip: { trigger: 'item' },
    series: [{ type: 'sankey', nodeAlign: 'justify', emphasis: { focus: 'adjacency' } }],
  },
} as const;

const hierarchyChart = {
  version: 1,
  renderer: 'echarts',
  data: {
    kind: 'inline',
    shape: 'hierarchy',
    source: [{
      id: 'all',
      name: '全部技能',
      children: [
        { id: 'analysis', name: '分析类', children: [
          { id: 'diagnosis', name: '诊断', value: 70 },
          { id: 'quality', name: '数据质量', value: 30 },
        ] },
        { id: 'artifact', name: '产物类', value: 50 },
      ],
    }],
  },
  spec: {
    title: { text: '技能构成（示例数据）' },
    tooltip: { trigger: 'item' },
    series: [{ type: 'treemap', label: { show: true } }],
  },
} as const;

const tableChart = {
  version: 1,
  renderer: 'table',
  data: {
    kind: 'inline',
    source: [
      { region: '华东', sales: 1_280_000, growth: 0.18, target: 0.91, apr: 31, may: 36, jun: 42 },
      { region: '华南', sales: 960_000, growth: -0.04, target: 0.74, apr: 27, may: 26, jun: 25 },
      { region: '华北', sales: 1_120_000, growth: 0.07, target: 0.83, apr: 29, may: 31, jun: 34 },
      { region: '西南', sales: 780_000, growth: 0.12, target: 0.68, apr: 18, may: 21, jun: 24 },
    ],
  },
  spec: {
    title: '区域经营明细',
    height: 420,
    columns: [
      { field: 'region', title: '区域', pinned: 'left' },
      {
        field: 'sales', title: '销售额', type: 'number',
        format: { style: 'currency', currency: 'CNY', notation: 'compact' },
      },
      {
        field: 'growth', title: '同比', type: 'number',
        format: { style: 'percent', maximumFractionDigits: 0 },
        cell: { kind: 'change', polarity: 'higher-is-better' },
      },
      {
        field: 'target', title: '目标完成', type: 'number',
        format: { style: 'percent', maximumFractionDigits: 0 },
        cell: { kind: 'progress', min: 0, max: 1, clamp: true },
      },
      {
        id: 'trend', title: '近三月',
        cell: {
          kind: 'sparkline', fields: ['apr', 'may', 'jun'],
          labels: ['4月', '5月', '6月'], scale: 'column',
        },
      },
    ],
    initialSort: [{ field: 'sales', direction: 'desc' }],
  },
} as const;

function markdownSource(mode: 'inline' | 'ref'): string {
  const data = mode === 'inline'
    ? { kind: 'inline', dimensions, source: rows }
    : { kind: 'ref', ref: 'demo://经营风险日报', format: 'json', dimensions };
  const datasets = {
    inventory: mode === 'inline'
      ? { kind: 'inline', dimensions: inventoryDimensions, source: inventoryRows }
      : { kind: 'ref', ref: 'demo://门店库存', format: 'json', dimensions: inventoryDimensions },
  };
  return `## 经营风险概览

同一组中同时展示默认数据和独立库存数据集。右上角引用由宿主打开 Wiki，图表包不解析 Wiki。

\`\`\`markdown-chart
${JSON.stringify({ version: 1, renderer: 'kpi', data, datasets, spec }, null, 2)}
\`\`\`

## 结构化数据

同一份节点、边或 children 数据同时驱动图形和 Data 视图。

\`\`\`markdown-chart
${JSON.stringify(graphChart, null, 2)}
\`\`\`

\`\`\`markdown-chart
${JSON.stringify(hierarchyChart, null, 2)}
\`\`\`

## 可筛选经营表格

表格支持排序、列筛选、搜索、CSV 导出，以及变化、进度和近三月小趋势图。

\`\`\`markdown-chart
${JSON.stringify(tableChart, null, 2)}
\`\`\``;
}

export function App() {
  const [mode, setMode] = useState<'inline' | 'ref'>('inline');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [continuation, setContinuation] = useState('');
  const [selectedReference, setSelectedReference] = useState<ChartReferenceEvent>();
  const source = useMemo(() => markdownSource(mode), [mode]);
  const openReference = useCallback((event: ChartReferenceEvent) => {
    setSelectedReference(event);
  }, []);
  const resolveDataRef = useCallback(async (ref: string): Promise<ResolvedChartData> => {
    return ref === 'demo://门店库存'
      ? { dimensions: inventoryDimensions, source: inventoryRows }
      : { dimensions, source: rows };
  }, []);
  const validateDataRef = useCallback(
    (ref: string) => ref === 'demo://经营风险日报' || ref === 'demo://门店库存',
    [],
  );
  const kpi = useMemo(
    () => ({ resolveDataRef, validateDataRef, referenceIcon: createKnowledgeBaseIcon }),
    [resolveDataRef, validateDataRef],
  );
  const canOpenReference = useCallback(
    (event: ChartReferenceEvent) => Object.prototype.hasOwnProperty.call(wikiContent, event.reference.ref),
    [],
  );
  const referenceActions = useMemo(
    () => ({ canOpen: canOpenReference, open: openReference }),
    [canOpenReference, openReference],
  );
  const selectedWiki = selectedReference ? wikiContent[selectedReference.reference.ref] : undefined;

  return (
    <main className="demo-shell">
      <section className="conversation-card" aria-label="KPI streaming example">
        <div className="message-header">
          <div>
            <div className="message-role">ADA · 数据分析助手</div>
            <div className="mode-note">canonical data：{mode === 'inline' ? 'Inline 宽表' : 'Ref（宿主 resolver 物化）'}</div>
          </div>
          <div className="message-controls">
            <div className="data-mode" role="group" aria-label="数据来源">
              <button type="button" aria-pressed={mode === 'inline'} onClick={() => setMode('inline')}>Inline</button>
              <button type="button" aria-pressed={mode === 'ref'} onClick={() => setMode('ref')}>Ref</button>
            </div>
            <div className="data-mode" role="group" aria-label="图表主题">
              <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>浅色</button>
              <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>深色</button>
            </div>
          </div>
        </div>
        <MarkdownChart
          source={`${source}${continuation}`}
          streaming
          theme={theme}
          kpi={kpi}
          referenceActions={referenceActions}
        />
        <div className="demo-actions">
          <button
            type="button"
            onClick={() => setContinuation('\n\n建议优先补充高风险门店库存，并持续跟踪流失营收。')}
          >
            模拟流式续写
          </button>
          <span data-stream-state>{continuation ? '已追加，KPI 保持挂载' : '等待追加文本'}</span>
        </div>
      </section>
      {selectedReference && selectedWiki ? (
        <aside className="reference-panel" aria-label="Wiki 内容">
          <div className="reference-panel-header">
            <strong>Wiki 引用</strong>
            <button type="button" aria-label="关闭引用" onClick={() => setSelectedReference(undefined)}>×</button>
          </div>
          <div className="wiki-breadcrumb">{selectedWiki.breadcrumb}</div>
          <h2>{selectedWiki.title}</h2>
          <div className="wiki-version">版本 · 2026-09-01</div>
          <p>{selectedWiki.body}</p>
          <code>{selectedReference.reference.ref}</code>
        </aside>
      ) : null}
    </main>
  );
}
