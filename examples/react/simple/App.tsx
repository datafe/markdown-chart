import { useCallback, useMemo, useState } from 'react';
import type {
  ChartDataRow,
  ChartReferenceEvent,
  ResolvedChartData,
} from '@datafe-open/markdown-chart';
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

const dimensions = [
  'day',
  'unmetDemand',
  'lostRevenueWan',
  'incrementalRevenue',
  'storeInventory',
  'inventoryStatus',
  'inventoryTone',
] as const;

const rows: readonly ChartDataRow[] = [
  ['08-27', 0.31, 510, 12_600_000, '31/48', '库存安全', 'positive'],
  ['08-28', 0.33, 548, 13_400_000, '29/48', '库存安全', 'positive'],
  ['08-29', 0.35, 590, 14_500_000, '27/48', '库存偏低', 'warning'],
  ['08-30', 0.36, 632, 15_700_000, '25/48', '库存偏低', 'warning'],
  ['08-31', 0.38, 681, 16_800_000, '24/48', '低于安全水位', 'negative'],
  ['09-01', 0.4, 720, 18_000_000, '23/48', '低于安全水位', 'negative'],
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

function markdownSource(mode: 'inline' | 'ref'): string {
  const data = mode === 'inline'
    ? { kind: 'inline', dimensions, source: rows }
    : { kind: 'ref', ref: 'demo://经营风险日报', format: 'json', dimensions };
  return `## 经营风险概览

同一组中同时展示有趋势和无趋势 KPI。右上角引用由宿主打开 Wiki，图表包不解析 Wiki。

\`\`\`markdown-chart
${JSON.stringify({ version: 1, renderer: 'kpi', data, spec }, null, 2)}
\`\`\``;
}

export function App() {
  const [mode, setMode] = useState<'inline' | 'ref'>('inline');
  const [continuation, setContinuation] = useState('');
  const [selectedReference, setSelectedReference] = useState<ChartReferenceEvent>();
  const source = useMemo(() => markdownSource(mode), [mode]);
  const openReference = useCallback((event: ChartReferenceEvent) => {
    setSelectedReference(event);
  }, []);
  const resolveDataRef = useCallback(async (): Promise<ResolvedChartData> => {
    return { dimensions, source: rows };
  }, []);
  const validateDataRef = useCallback((ref: string) => ref === 'demo://经营风险日报', []);
  const kpi = useMemo(() => ({ resolveDataRef, validateDataRef }), [resolveDataRef, validateDataRef]);
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
          <div className="data-mode" role="group" aria-label="数据来源">
            <button type="button" aria-pressed={mode === 'inline'} onClick={() => setMode('inline')}>Inline</button>
            <button type="button" aria-pressed={mode === 'ref'} onClick={() => setMode('ref')}>Ref</button>
          </div>
        </div>
        <MarkdownChart
          source={`${source}${continuation}`}
          streaming
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
