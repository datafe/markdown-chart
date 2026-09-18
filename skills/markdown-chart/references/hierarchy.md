# Hierarchy

树、矩形树和旭日图使用 `data.shape: "hierarchy"`，source 是非空根节点数组。
每个节点有唯一 id 和可读 name；父子关系只由 children 表示。非叶子不写 value。

- `tree`：恰好一个根；叶子 value 可省略，表示纯结构。
- `treemap` / `sunburst`：可多根；每个叶子必须有有限非负 value，总量大于零。
- 父级面积由 renderer 对叶值求和；若存在未展开量，分析过程增加真实“其它”叶子。
- `children: []` 按叶子处理。不要同时再写 parentId 或 `series.data`。

## 完整矩形树示例

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "shape": "hierarchy",
    "source": [{
      "id": "all",
      "name": "全部技能",
      "children": [
        {"id": "analysis", "name": "分析类", "children": [
          {"id": "diagnosis", "name": "诊断", "value": 70},
          {"id": "quality", "name": "质量", "value": 30}
        ]},
        {"id": "artifact", "name": "产物类", "value": 50}
      ]
    }]
  },
  "spec": {
    "title": {"text": "技能构成（示例数据）"},
    "tooltip": {"trigger": "item"},
    "series": [{"type": "treemap", "label": {"show": true}}]
  }
}
```

结构化 ref 只接受真实 `artifact://` 或 `session-file://` JSON，文件内容直接为根数组。
生成后必须执行 validator；修复重复 id、非叶 value、面积叶缺 value、tree 多根或超过 20 层
等明确错误一次。仍无法可靠表达时改用表格或文字，不能猜造父子关系或补零。
