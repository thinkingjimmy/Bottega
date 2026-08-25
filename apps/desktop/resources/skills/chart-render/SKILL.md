---
name: chart-render
displayName: 图表渲染
description: 用图表、统计、占比、趋势或 chart 展示数据，在聊天正文生成可渲染的七类图表围栏。
---

# 图表渲染

在回复正文输出 `chart` 围栏。它是落库即定格的数据快照；要持续随 Base 数据更新，请配置 Base 的 Chart 视图。

## 围栏还是视图？

- 正文 ```chart 围栏 = 落库即定格的快照，适合「本次回答里看一眼」；本 skill 不要求任何工具，围栏永远可用。
- 要持续随 Base 数据更新的图表：若本轮工具列表里有 `base_set_view`（需要 Base 写权限），用它建 `type:"chart"` 的命名视图（配方见 base-ops skill），不要重复输出围栏刷新数据；若没有该工具（只读或无 Base 面），建议用户在 Base 界面手动添加 Chart 视图。

## 合同

紧凑 JSON 结构：

```json
{"type":"pie|bar|line|stacked-bar|scatter|radar|heatmap","title":"可选，最多120字符","labels":["最多120项，每项最多40字符"],"series":[{"name":"多序列必填且唯一，最多40字符","data":[1,null]}]}
```

- 每条 `data` 长度必须等于 `labels` 长度；总点数不超过 2000。
- 单图 `JSON.stringify(payload)` 的 UTF-8 字节数不超过 12KB；每条回复最多 2 图。
- pie 恰好 1 序列；scatter 恰好 2 序列；heatmap 每条序列必须命名。
- 多序列全部命名且唯一。至少一个非 null 数据点。
- 数据来自 Base 时先用 `base_query` 汇总；不要把原始明细行塞进图表。

## 七型最小示例

```chart
{"type":"pie","labels":["餐饮","交通"],"series":[{"data":[1280,340]}]}
```

```chart
{"type":"bar","labels":["7月","8月"],"series":[{"name":"支出","data":[5520,4980]}]}
```

```chart
{"type":"line","labels":["7月","8月"],"series":[{"name":"收入","data":[12000,13500]}]}
```

```chart
{"type":"stacked-bar","labels":["7月","8月"],"series":[{"name":"收入","data":[12000,13500]},{"name":"支出","data":[5520,4980]}]}
```

```chart
{"type":"scatter","labels":["07-01","07-02"],"series":[{"name":"支出","data":[320,180]},{"name":"收入","data":[0,800]}]}
```

```chart
{"type":"radar","labels":["餐饮","交通","居住"],"series":[{"name":"收入","data":[0,200,0]},{"name":"支出","data":[1280,340,4200]}]}
```

```chart
{"type":"heatmap","labels":["07-01","07-02"],"series":[{"name":"餐饮","data":[80,120]},{"name":"交通","data":[30,null]}]}
```
