# Third-Party Notices

## Qwen Code

Portions of the chart card, Chart/Data icons, data-table presentation, and
ECharts presentation defaults in this repository are adapted from Qwen Code:

- Project: [QwenLM/qwen-code](https://github.com/QwenLM/qwen-code)
- Revision: [89ab15d2f1bc253d4375e508130462ad5df3c56f](https://github.com/QwenLM/qwen-code/tree/89ab15d2f1bc253d4375e508130462ad5df3c56f)
- Source:
  [EchartsFullDataBlock.tsx](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.tsx)
  and
  [EchartsFullDataBlock.module.css](https://github.com/QwenLM/qwen-code/blob/89ab15d2f1bc253d4375e508130462ad5df3c56f/packages/web-shell/client/components/messages/EchartsFullDataBlock.module.css)
- License: Apache License 2.0

The adapted implementation has been rewritten around the framework-neutral
markdown-chart renderer lifecycle. In particular, markdown-chart preserves the
mounted chart while the Data view is selected and resizes it when returning to
the Chart view.

A copy of the Apache License 2.0 is available at
[LICENSES/Apache-2.0.txt](./LICENSES/Apache-2.0.txt).
