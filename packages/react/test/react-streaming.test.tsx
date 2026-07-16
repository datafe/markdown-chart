// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { MarkdownChart } from '../src/index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const canonicalBody = JSON.stringify({
  version: 1,
  renderer: 'test',
  data: {
    kind: 'inline',
    dimensions: ['month', 'sales'],
    source: [['Jan', 100], ['Feb', 180]],
  },
  spec: {},
});

function closedChart(trailing = ''): string {
  return `\`\`\`markdown-chart\n${canonicalBody}\n\`\`\`${trailing}`;
}

describe('MarkdownChart streaming lifecycle', () => {
  it('renders a closed fence during streaming and preserves it as text is appended', async () => {
    const mount = vi.fn();
    const dispose = vi.fn();
    const resize = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount(container) {
        mount(container);
        return { dispose, resize };
      },
    });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownChart source={closedChart()} registry={registry} streaming />);
    });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const original = container.querySelector('.markdown-chart-placeholder');

    await act(async () => {
      root.render(
        <MarkdownChart
          source={closedChart('\n\nThe analysis continues.')}
          registry={registry}
          streaming
        />,
      );
    });
    expect(container.querySelector('.markdown-chart-placeholder')).toBe(original);
    expect(mount).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    const showData = container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    const dataView = container.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    showData?.click();
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.textContent).toContain('Jan');

    const showChart = container.querySelector<HTMLButtonElement>('button[aria-label="Show chart"]');
    showChart?.click();
    expect(resize).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('waits for the active unterminated fence and mounts it when closed', async () => {
    const mount = vi.fn();
    const parse = vi.fn((spec) => spec);
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse,
      mount() {
        mount();
      },
    });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownChart source={`\`\`\`markdown-chart\n${canonicalBody}`} registry={registry} streaming />);
    });
    expect(container.querySelector('.markdown-chart-streaming')).not.toBeNull();
    expect(parse).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MarkdownChart source={closedChart()} registry={registry} streaming />);
    });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(parse).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
