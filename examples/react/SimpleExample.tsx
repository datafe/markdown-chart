import { MarkdownChart } from '@datafe/markdown-chart-react';

export interface SimpleExampleProps {
  readonly source: string;
}

export function SimpleExample({ source }: SimpleExampleProps) {
  return <MarkdownChart source={source} />;
}
