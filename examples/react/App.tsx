import { AdvancedExample } from './AdvancedExample';
import { SimpleExample } from './SimpleExample';
import { source } from './source';

export function App() {
  return (
    <main>
      <h1>React integration examples</h1>

      <section>
        <h2>Simple mode</h2>
        <p>The adapter owns react-markdown and creates the ECharts registry.</p>
        <SimpleExample source={source} />
      </section>

      <section>
        <h2>Advanced mode</h2>
        <p>The host owns ReactMarkdown, the component mapping, and the registry.</p>
        <AdvancedExample source={source} />
      </section>
    </main>
  );
}
