import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const packages = ['core', 'echarts', 'markdown-it', 'react', 'vue'];

for (const packageName of packages) {
  const output = execFileSync(pnpm, ['pack', '--dry-run', '--json'], {
    cwd: path.join(root, 'packages', packageName),
    encoding: 'utf8',
  });
  const manifest = JSON.parse(output);
  const files = new Set(manifest.files.map((file) => file.path));
  for (const required of ['LICENSE', 'NOTICE']) {
    if (!files.has(required)) {
      throw new Error(`${manifest.name} tarball is missing ${required}`);
    }
  }
  console.log(`${manifest.name}: LICENSE, NOTICE`);
}
