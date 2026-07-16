import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const packages = ['core', 'echarts', 'markdown-it', 'react', 'vue'];
const thirdPartyPackages = new Set(['core', 'echarts']);

for (const packageName of packages) {
  const output = execFileSync(pnpm, ['pack', '--dry-run', '--json'], {
    cwd: path.join(root, 'packages', packageName),
    encoding: 'utf8',
  });
  const manifest = JSON.parse(output);
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
  console.log(`${manifest.name}: ${requiredFiles.join(', ')}`);
}
