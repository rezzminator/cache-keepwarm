import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const arg = process.argv.indexOf('--root');
const root = resolve(arg >= 0 ? process.argv[arg + 1] : fileURLToPath(new URL('../', import.meta.url)));
try {
  const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const version = json('package.json').version;
  const plugin = json('plugins/cache-keepwarm/.claude-plugin/plugin.json');
  const entry = json('.claude-plugin/marketplace.json').plugins.find(p => p.name === 'cache-keepwarm');
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  if (!/^\d+\.\d+\.\d+$/.test(version) || plugin.version !== version || entry?.version !== version || !readme.includes(`version-${version}-`) || !changelog.includes(`## [${version}]`)) throw new Error('version mismatch across package/plugin/marketplace/README/CHANGELOG');
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `cache-keepwarm--v${version}`) throw new Error('tag does not match version');
  const base = process.env.RELEASE_BASE_VERSION;
  if (base !== undefined) {
    if (!/^\d+\.\d+\.\d+$/.test(base)) throw new Error('invalid release base version');
    const current = version.split('.').map(Number), previous = base.split('.').map(Number);
    const different = current.findIndex((n, i) => n !== previous[i]);
    if (different < 0 || current[different] <= previous[different]) throw new Error('release version must advance past main');
  }
  console.log(`PASS release: cache-keepwarm ${version}`);
} catch (error) { console.error(`FAIL ${error.message}`); process.exit(1); }
