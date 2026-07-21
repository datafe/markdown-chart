import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const tsc = path.join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);
const packages = ['core', 'echarts', 'markdown-it', 'react', 'vue'];
const thirdPartyPackages = new Set(['core', 'echarts']);
const repositoryUrl = 'https://github.com/datafe/markdown-chart.git';
const registryUrl = 'https://registry.npmjs.org/';
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'markdown-chart-pack-'));
const packDirectory = path.join(temporaryRoot, 'tarballs');
const consumerDirectory = path.join(temporaryRoot, 'consumer');
mkdirSync(packDirectory);
mkdirSync(consumerDirectory);

try {
  const tarballs = new Map();
  for (const packageName of packages) {
    const packageDirectory = path.join(root, 'packages', packageName);
    const packageJson = JSON.parse(
      readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
    );
    if (packageJson.private === true) {
      throw new Error(`${packageJson.name} must not be private`);
    }
    if (packageJson.publishConfig?.access !== 'public') {
      throw new Error(`${packageJson.name} must publish with public access`);
    }
    if (packageJson.publishConfig?.registry !== registryUrl) {
      throw new Error(`${packageJson.name} must publish to ${registryUrl}`);
    }
    if (packageJson.repository?.url !== repositoryUrl) {
      throw new Error(`${packageJson.name} repository must be ${repositoryUrl}`);
    }
    if (packageJson.repository?.directory !== `packages/${packageName}`) {
      throw new Error(`${packageJson.name} repository directory is incorrect`);
    }

    const output = execFileSync(
      pnpm,
      ['pack', '--pack-destination', packDirectory, '--json'],
      { cwd: packageDirectory, encoding: 'utf8' },
    );
    const parsed = JSON.parse(output);
    const manifest = Array.isArray(parsed) ? parsed[0] : parsed;
    const files = new Set(manifest.files.map((file) => file.path));
    const requiredFiles = ['LICENSE'];
    if (thirdPartyPackages.has(packageName)) {
      requiredFiles.push(
        'LICENSES/Apache-2.0.txt',
        'THIRD_PARTY_NOTICES.md',
      );
    }
    for (const required of requiredFiles) {
      if (!files.has(required)) {
        throw new Error(`${manifest.name} tarball is missing ${required}`);
      }
    }
    tarballs.set(
      manifest.name,
      path.isAbsolute(manifest.filename)
        ? manifest.filename
        : path.join(packDirectory, manifest.filename),
    );
    console.log(`${manifest.name}: metadata, ${requiredFiles.join(', ')}`);

    if (packageName === 'react') {
      if (files.has('dist/index.cjs')) {
        throw new Error(`${manifest.name} ESM-only tarball includes dist/index.cjs`);
      }
    }
  }

  const localPackages = Object.fromEntries(
    [...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  writeFileSync(path.join(consumerDirectory, 'package.json'), JSON.stringify({
    name: 'markdown-chart-pack-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: {
      ...localPackages,
      echarts: '^6.0.0',
      'markdown-it': '^14.1.0',
      react: '^19.1.0',
      vue: '^3.5.13',
    },
    pnpm: { overrides: localPackages },
  }, null, 2));
  execFileSync(
    pnpm,
    ['install', '--ignore-workspace', '--ignore-scripts', '--no-frozen-lockfile'],
    { cwd: consumerDirectory, encoding: 'utf8' },
  );
  const installedReactManifest = JSON.parse(readFileSync(
    path.join(
      consumerDirectory,
      'node_modules',
      '@datafe-open',
      'markdown-chart-react',
      'package.json',
    ),
    'utf8',
  ));
  if ('main' in installedReactManifest || installedReactManifest.exports?.['.']?.require) {
    throw new Error('@datafe-open/markdown-chart-react must not publish a CommonJS entry point');
  }

  writeFileSync(
    path.join(consumerDirectory, 'import-smoke.mjs'),
    [
      "import { MarkdownChart } from '@datafe-open/markdown-chart-react';",
      "import { LegacySandboxError, createLegacySandboxClient } from '@datafe-open/markdown-chart-echarts';",
      "if (typeof MarkdownChart !== 'function') throw new Error('React ESM export is unavailable');",
      "if (typeof createLegacySandboxClient !== 'function') throw new Error('ECharts legacy sandbox ESM export is unavailable');",
      "if (new LegacySandboxError('LEGACY_SANDBOX_FATAL', 'smoke').code !== 'LEGACY_SANDBOX_FATAL') throw new Error('ECharts legacy sandbox ESM error export is unavailable');",
      '',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['import-smoke.mjs'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  });
  console.log(`React and ECharts legacy sandbox: ESM imports passed on Node ${process.versions.node}`);

  writeFileSync(
    path.join(consumerDirectory, 'require-smoke.cjs'),
    [
      "const { LegacySandboxError, createLegacySandboxClient } = require('@datafe-open/markdown-chart-echarts');",
      "if (typeof createLegacySandboxClient !== 'function') throw new Error('ECharts legacy sandbox CJS export is unavailable');",
      "const client = createLegacySandboxClient({ transport: { listFiles: async () => [], readFile: async () => '', classifyError: () => 'fatal' } });",
      "const binding = client.bind({ sessionId: 'session', requestId: 'request', phase: 'live', cacheScopeKey: 'tenant:user' });",
      "if (typeof binding.resolveLegacyArtifactContent !== 'function' || typeof binding.shouldDefer !== 'function') throw new Error('ECharts legacy sandbox CJS binding is unavailable');",
      "if (new LegacySandboxError('LEGACY_SANDBOX_FATAL', 'smoke').code !== 'LEGACY_SANDBOX_FATAL') throw new Error('ECharts legacy sandbox CJS error export is unavailable');",
      '',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['require-smoke.cjs'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  });
  console.log(`@datafe-open/markdown-chart-echarts: CJS require passed on Node ${process.versions.node}`);

  writeFileSync(path.join(consumerDirectory, 'strict-consumer.ts'), [
    "import { markdownChartPlugin, type MarkdownChartPluginOptions } from '@datafe-open/markdown-chart-markdown-it';",
    "import { MarkdownChart } from '@datafe-open/markdown-chart-vue';",
    "import { LegacySandboxError, createLegacySandboxClient, type LegacySandboxBinding, type LegacySandboxContext, type LegacySandboxErrorCode, type LegacySandboxFile, type LegacySandboxTransport } from '@datafe-open/markdown-chart-echarts';",
    'interface HostFile extends LegacySandboxFile { readonly downloadId: string; }',
    "const hostFile: HostFile = { fileName: 'a.csv', filePath: 'a.csv', originalFilePath: '', fileType: 'csv', downloadId: 'download' };",
    "const transport: LegacySandboxTransport<HostFile> = { listFiles: async () => [hostFile], readFile: async ({ file }) => file.downloadId, classifyError: () => 'fatal' };",
    "const context: LegacySandboxContext = { sessionId: 'session', requestId: 'request', phase: 'live', cacheScopeKey: 'tenant:user' };",
    'const binding: LegacySandboxBinding = createLegacySandboxClient({ transport }).bind(context);',
    "const code: LegacySandboxErrorCode = new LegacySandboxError('LEGACY_SANDBOX_FATAL', 'typed smoke').code;",
    'const options: MarkdownChartPluginOptions = {};',
    'void binding;',
    'void code;',
    'void markdownChartPlugin;',
    'void options;',
    'void MarkdownChart;',
    '',
  ].join('\n'));
  writeFileSync(path.join(consumerDirectory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      strict: true,
      exactOptionalPropertyTypes: true,
      skipLibCheck: false,
      esModuleInterop: true,
      noEmit: true,
    },
    include: ['strict-consumer.ts'],
  }, null, 2));
  execFileSync(tsc, ['-p', 'tsconfig.json'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  });
  console.log('markdown-it, Vue, and ECharts legacy sandbox: isolated strict TypeScript consumer passed');
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
