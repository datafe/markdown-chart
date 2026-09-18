# markdown-chart 最终输出回归

验证对象是最终回答里的完整 `markdown-chart` 块。草稿、validator 调用日志、
“已校验”文字都不能替代最终输出。测试工具只在仓库内使用，不进入 Skill 分发目录。

## 静态回归

在仓库根执行：

```bash
node --test tests/skills/markdown-chart/*.test.mjs
```

覆盖 Skill/reference 中的完整样例、原故障的 JavaScript formatter、字符串 formatter、
重复轴/系列数据、缺失/未闭合/额外图表，以及 encode 实际指向的金额与 KPI 百分比尺度。

## 检查真实最终回答

将终态消息原样保存为 Markdown 文件，不从中提取或修补 JSON，再运行：

```bash
node tests/skills/markdown-chart/check_final_answer.mjs /path/to/final-answer.md 1
```

最后的 case-id 来自 `evals.json`；省略时只检查一个完整图表的格式与 validator 契约。
指定 case 时还检查对应源值、字段映射、单位、标签等；退出码 0 表示通过。
用例包含：渠道 GMV 双轴与配色、中文横向排名、KPI 原始比例/已乘100的百分比，
以及 `week/category/GMV` 长表转 chart-ready 宽表的多系列折线。

## Qwen Code 模型评测

安装好的 Qwen Code CLI 在新 sandbox 中加载 Skill。使用本机已获授权的模型环境，
先设置 `QWEN_EVAL_MODEL`、`OPENAI_BASE_URL`、`OPENAI_API_KEY`；不要把密钥写入文件。
runner 显式传模型和 openai auth，`--bare` 隔离用户自动加载的 hooks、MCP 和其它 Skill。
给定数据的隔离评测使用 `--approval-mode yolo` 允许在临时目录创建草稿并运行内置
validator，避免把人工审批等待计入对照组耗时；仅用于这里的固定用例。
逐行保存 `stream-json` 事件，避免大体积终态 JSON 一次写出被截断。

```bash
node tests/skills/markdown-chart/run_eval.mjs skills/markdown-chart 1 /tmp/chart-eval-new-1
```

每个用例各运行一次；目录必须不存在。对照组传入旧版本 Skill 目录，使用同一个
模型和提示，输出到另一个新目录。runner 保存完整 CLI 结果、终态 Markdown、耗时、
最终输出 grading；认证/进程失败记为 runtime-error，不算作模型生成质量。
Skill 可以按自身指令使用工具；新版本简单图没有预检工具调用要求。

评测使用提示里已给的数据，不调用真实 Connector 或 ADA Session API。
因此只证明该模型在隔离 Skill 场景的生成表现；生产版本是否加载、宿主是否成功渲染，
以及稳定的延迟收益需要部署后的会话验收。少量单次样本不构成速度 SLA。
