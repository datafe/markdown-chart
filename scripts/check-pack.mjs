import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const packages = ['core', 'echarts', 'markdown-it', 'react', 'vue'];
const thirdPartyPackages = new Set(['core', 'echarts']);
const repositoryUrl = 'https://github.com/datafe/markdown-chart.git';
const registryUrl = 'https://registry.npmjs.org/';

for (const packageName of packages) {
  const packageRoot = path.join(root, 'packages', packageName);
  const packageJson = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
  );
  const output = execFileSync(pnpm, ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const manifest = JSON.parse(output);
  if (packageJson.private === true) {
    throw new Error(`${manifest.name} must not be private`);
  }
  if (packageJson.publishConfig?.access !== 'public') {
    throw new Error(`${manifest.name} must publish with public access`);
  }
  if (packageJson.publishConfig?.registry !== registryUrl) {
    throw new Error(`${manifest.name} must publish to ${registryUrl}`);
  }
  if (packageJson.repository?.url !== repositoryUrl) {
    throw new Error(`${manifest.name} repository must be ${repositoryUrl}`);
  }
  if (packageJson.repository?.directory !== `packages/${packageName}`) {
    throw new Error(`${manifest.name} repository directory is incorrect`);
  }
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
  console.log(`${manifest.name}: metadata, ${requiredFiles.join(', ')}`);
}
