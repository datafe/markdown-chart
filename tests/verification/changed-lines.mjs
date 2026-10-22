// Reproducible diff coverage for product sources. Test/evaluation tools and JSON fixtures are excluded.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const [base, toolsDirectory, output = 'coverage/changed-lines.json'] = process.argv.slice(2);
if (!base || !toolsDirectory) throw new Error('Usage: node tests/verification/changed-lines.mjs <base> <coverage-tools-directory> [output]');
const require = createRequire(path.resolve(toolsDirectory, 'package.json'));
const { createCoverageMap } = require('istanbul-lib-coverage');
const convert = require('v8-to-istanbul');
const root = process.cwd();
const map = createCoverageMap({});
if (fs.existsSync('coverage/coverage-final.json')) map.merge(JSON.parse(fs.readFileSync('coverage/coverage-final.json')));
if (fs.existsSync('coverage/node-v8')) {
  for (const file of fs.readdirSync('coverage/node-v8').filter(f => f.endsWith('.json'))) {
    for (const entry of JSON.parse(fs.readFileSync(path.join('coverage/node-v8', file))).result) {
      if (!entry.url.startsWith('file:')) continue;
      const source = fileURLToPath(entry.url);
      if (!source.startsWith(root + path.sep) || source.includes('/node_modules/') || !fs.existsSync(source)) continue;
      const converter = convert(source, 0, { source: fs.readFileSync(source, 'utf8') });
      await converter.load();
      converter.applyCoverage(entry.functions);
      map.merge(converter.toIstanbul());
    }
  }
}
const diff = execFileSync('git', ['diff', '--unified=0', base, '--'], { encoding: 'utf8' });
const changed = new Map();
let filename;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) filename = line.slice(6);
  else if (filename && line.startsWith('@@')) {
    const [, start, count = '1'] = line.match(/\+(\d+)(?:,(\d+))?/);
    const lines = changed.get(filename) ?? new Set();
    for (let i = +start; i < +start + +count; i++) lines.add(i);
    changed.set(filename, lines);
  }
}
const files = [], excluded = [];
for (const [file, lines] of changed) {
  if (!/\.(?:ts|tsx|js|mjs|cjs|vue)$/.test(file) || !fs.existsSync(file)) continue;
  if (/(?:^|\/)(?:test|tests|fixtures)\//.test(file) || /\.test\./.test(file)) {
    excluded.push({ path: file, reason: 'test/evaluation tool or fixture' }); continue;
  }
  const absolute = path.resolve(file);
  const mapped = map.files().includes(absolute) ? map.fileCoverageFor(absolute).getLineCoverage() : null;
  const sourceLines = fs.readFileSync(file, 'utf8').split('\n');
  const executable = [...lines].filter(n => mapped ? Object.hasOwn(mapped, n) : sourceLines[n - 1]?.trim() && !/^\s*(?:\/\/|\/\*|\*|<!--)/.test(sourceLines[n - 1]));
  files.push({ path: file, changed: executable.length, covered: executable.filter(n => mapped?.[n] > 0).length, tool: mapped ? 'Vitest V8 / Node V8 + v8-to-istanbul' : 'conservative nonempty lines, no UT coverage', uncovered: executable.filter(n => !mapped?.[n]) });
}
const changedExecutableLines = files.reduce((n, f) => n + f.changed, 0);
const coveredChangedLines = files.reduce((n, f) => n + f.covered, 0);
const percent = changedExecutableLines ? coveredChangedLines / changedExecutableLines * 100 : 100;
const report = { base, head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), changedExecutableLines, coveredChangedLines, percent, files, excluded };
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
process.exitCode = percent >= 60 ? 0 : 1;
