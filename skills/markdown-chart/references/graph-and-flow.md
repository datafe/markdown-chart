# Graph 与 Flow

桑基和关系网络使用 `data.shape: "graph"`。事实只写在 `data.source.nodes/links`；
`spec.series` 恰好一个，不能写 `data`、`nodes`、`links` 或 `edges`。

## 选型

- 有方向、有非负流量且无环：`sankey`。每条 link 必须有 value，总流量需大于零。
- 任意关系、可有环、权重可省略：`graph`。分类来自 node.category。
- 同名节点可以存在，但 id 必须全局唯一；边只引用 id。不要把显示名当端点。
- 同一 source→target 先按业务口径聚合成一条边。桑基不自动补“其它”或平衡流量。

## 完整桑基示例

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "shape": "graph",
    "source": {
      "nodes": [
        {"id": "entry", "name": "首次进入", "category": "入口"},
        {"id": "analysis", "name": "分析", "category": "结果"},
        {"id": "artifact", "name": "产物", "category": "结果"}
      ],
      "links": [
        {"source": "entry", "target": "analysis", "value": 70},
        {"source": "entry", "target": "artifact", "value": 30}
      ]
    }
  },
  "spec": {
    "title": {"text": "会话流向（示例数据）"},
    "tooltip": {"trigger": "item"},
    "series": [{"type": "sankey", "nodeAlign": "justify", "emphasis": {"focus": "adjacency"}}]
  }
}
```

结构化 ref 只在已有真实资源时使用：`kind:"ref"`、`shape:"graph"`、`format:"json"`；
文件内容就是 `{nodes,links}` source。公共组件不会自行请求 URL。

生成后必须执行 validator。若桑基报告自环、环路、缺 value 或零总流量，修正数据口径；
不能把 series 改成 graph 来掩盖本应是流向的问题。对话可读性建议桑基不超过约 20 个节点、
关系图不超过约 100 个节点；聚焦或汇总时在正文披露。
