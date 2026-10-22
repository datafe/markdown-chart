# Changed-line UT coverage

Run from this repository root. Dependencies stay in a temporary tool environment;
no product dependency or lockfile changes are required. Pin the V8 provider to
the lockfile's Vitest version (currently 3.2.7).

```sh
npm install --prefix /tmp/markdown-chart-coverage-tools --no-audit --no-fund @vitest/coverage-v8@3.2.7 v8-to-istanbul@9.3.0 istanbul-lib-coverage@3.2.2
mkdir -p node_modules/@vitest
ln -s /tmp/markdown-chart-coverage-tools/node_modules/@vitest/coverage-v8 node_modules/@vitest/coverage-v8
pnpm exec vitest run --coverage.enabled --coverage.provider=v8 --coverage.reporter=json --coverage.reporter=text-summary --coverage.include='packages/*/src/**' --coverage.include='examples/shared/*.ts' --coverage.include='examples/react/simple/App.tsx'
NODE_V8_COVERAGE=coverage/node-v8 node --test tests/skills/markdown-chart/*.test.mjs
node tests/verification/changed-lines.mjs 8011a151c605fffca043a4d9a9484c4b465dbba7 /tmp/markdown-chart-coverage-tools
```

Use fresh `coverage/` output for each final snapshot. The script intersects Git
added/modified lines with Istanbul line maps. Uninstrumented executable files
(e.g. Vue example imports/templates) conservatively count nonempty changed lines
as uncovered. JSON examples, docs and test/evaluation tools are excluded, with
code exclusions listed in the report. The command exits nonzero below 60%.
