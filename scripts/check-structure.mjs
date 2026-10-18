import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const arg = process.argv.indexOf('--root');
const root = resolve(arg >= 0 ? process.argv[arg + 1] : fileURLToPath(new URL('../', import.meta.url)));
let failed = false, count = 0;
const slash = String.fromCharCode(47);
const forbidden = [slash + 'home' + slash, slash + 'Users' + slash];
function inspect(path, text, label = path) {
  count++;
  if (forbidden.some(value => text.includes(value)) || (text.match(/[\w.+-]+@[\w.-]+\.(?:com|net|org)\b/g) ?? []).some(email => !/@example\.(?:com|net|org)$/.test(email))) { console.error(`LEAK ${label}`); failed = true; }
  if (/^plugins\/cache-keepwarm\/.*\.(ts|json)$/.test(path) && /\bprofessor\b|\bpfm\b/i.test(text)) { console.error(`STANDALONE ${label}`); failed = true; }
  if (/^(?:plugins\/cache-keepwarm\/src|tests)\/.*\.ts$/.test(path) && text.split('\n').length - 1 > 300) { console.error(`SIZE ${label}: exceeds 300 lines`); failed = true; }
  if (path === 'plugins/cache-keepwarm/hooks/cache-keepwarm.ts' && text.split('\n').length - 1 > 500) { console.error(`SIZE ${label}: exceeds 500 lines`); failed = true; }
  if (/^plugins\/cache-keepwarm\/src\/.*\.ts$/.test(path) && (/\$\./.test(text) || /^import (?!type\b)/m.test(text))) { console.error(`PURE ${label}`); failed = true; }
}
function candidate(name) {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep)) throw new Error(`candidate outside root: ${name}`);
  let current = root;
  for (const part of relative(root, path).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink not allowed: ${name}`);
  }
  if (!lstatSync(path).isFile()) throw new Error(`unsupported candidate: ${name}`);
  inspect(name, readFileSync(path, 'utf8'));
}
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && ['.git', 'node_modules', '.codex', '.opencode'].includes(entry.name)) continue;
    const path = join(dir, entry.name), name = relative(root, path);
    if (entry.isSymbolicLink()) throw new Error(`symlink not allowed: ${name}`);
    if (entry.isDirectory()) walk(path);
    else candidate(name);
  }
}
try {
  if (!lstatSync(root).isDirectory()) throw new Error('root is not a directory');
  let hasGit = false;
  try { const meta = lstatSync(join(root, '.git')); hasGit = meta.isDirectory() || meta.isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (hasGit) {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
    if (!paths.length) throw new Error('no candidate content enumerated');
    for (const path of new Set(paths)) candidate(path);
    const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
    for (const path of staged) inspect(path, git(['show', `:${path}`]), `staged:${path}`);
    console.log(`Enumerated ${new Set(paths).size} working candidates and ${staged.length} staged candidates`);
  } else walk(root);
  if (!count) throw new Error('no candidate content enumerated');
} catch (error) { console.error(`ERROR enumerate: ${error.message}`); process.exit(2); }
console.log(`${failed ? 'FAIL' : 'PASS'} structure: scanned ${count} candidate contents`);
process.exit(failed ? 1 : 0);
