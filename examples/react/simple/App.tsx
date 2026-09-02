import { useCallback, useState } from 'react';
import type { ChartReferenceEvent } from '@datafe-open/markdown-chart';
import { MarkdownChart } from '@datafe-open/markdown-chart-react';

const kpiSource = `## 经营风险概览

以下指标来自当前分析结果，可点击每张卡片右上角的引用查看口径。

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "spec": {
    "items": [
      {
        "id": "unmet_demand",
        "title": "未满足需求",
        "value": "40",
        "suffix": "%",
        "status": { "text": "流失中", "tone": "negative" },
        "references": [{ "ref": "docs://metrics/unmet-demand", "label": "未满足需求口径" }]
      },
      {
        "id": "lost_revenue",
        "title": "累计流失营收",
        "value": "720",
        "suffix": "万",
        "status": { "text": "持续扩大", "tone": "negative" },
        "references": [{ "ref": "docs://metrics/lost-revenue", "label": "流失营收口径" }]
      },
      {
        "id": "incremental_revenue",
        "title": "预估增量营收",
        "prefix": "¥",
        "value": "1,800",
        "suffix": "万",
        "references": [{ "ref": "docs://metrics/incremental-revenue", "label": "增量营收预测方法" }]
      },
      {
        "id": "store_inventory",
        "title": "门店库存",
        "value": "23/48",
        "status": { "text": "家庭低于安全水平", "tone": "warning" },
        "references": [{ "ref": "docs://metrics/store-inventory", "label": "门店安全库存口径" }]
      }
    ]
  }
}
\`\`\``;

export function App() {
  const [continuation, setContinuation] = useState('');
  const [selectedReference, setSelectedReference] = useState<ChartReferenceEvent>();
  const openReference = useCallback((event: ChartReferenceEvent) => {
    setSelectedReference(event);
  }, []);

  return (
    <main className="demo-shell">
      <section className="conversation-card" aria-label="KPI streaming example">
        <div className="message-role">ADA · 数据分析助手</div>
        <MarkdownChart
          source={`${kpiSource}${continuation}`}
          streaming
          referenceActions={{
            canOpen: () => true,
            open: openReference,
          }}
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
      {selectedReference ? (
        <aside className="reference-panel" aria-label="Reference details">
          <div className="reference-panel-header">
            <strong>指标引用</strong>
            <button type="button" aria-label="关闭引用" onClick={() => setSelectedReference(undefined)}>×</button>
          </div>
          <h2>{selectedReference.reference.label}</h2>
          <p>引用由宿主应用解析并展示；markdown-chart 只透传 opaque ref。</p>
          <code>{selectedReference.reference.ref}</code>
        </aside>
      ) : null}
    </main>
  );
}
