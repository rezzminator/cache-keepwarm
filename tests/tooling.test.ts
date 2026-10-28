import { expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
test('candidate scan distinguishes safe files, leaked paths, and failed enumeration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-scan-'));
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/check-structure.mjs'), '--root', dir], { encoding: 'utf8' });
  try {
    writeFileSync(join(dir, 'ok.txt'), 'safe\n');
    expect(run().status).toBe(0);
    writeFileSync(join(dir, 'bad.txt'), '/' + 'home' + '/example/private');
    expect(run().stdout + run().stderr).toContain('LEAK bad.txt');
    mkdirSync(join(dir, 'plugins/cache-keepwarm/.opencode'), { recursive: true });
    writeFileSync(join(dir, 'plugins/cache-keepwarm/.opencode/private.txt'), '/' + 'home' + '/example/private');
    expect(run().stdout + run().stderr).toContain('LEAK plugins/cache-keepwarm/.opencode/private.txt');
    rmSync(dir, { recursive: true });
    expect(run().stdout + run().stderr).toContain('ERROR enumerate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('release check verifies all public versions and names mismatches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-release-'));
  const run = () => spawnSync(process.execPath, [join(root, 'scripts/release-check.mjs'), '--root', dir], { encoding: 'utf8' });
  try {
    mkdirSync(join(dir, 'plugins/cache-keepwarm/.claude-plugin'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
    writeFileSync(join(dir, 'plugins/cache-keepwarm/.claude-plugin/plugin.json'), JSON.stringify({ name: 'cache-keepwarm', version: '0.1.0' }));
    writeFileSync(join(dir, 'README.md'), 'version-0.1.0-blue');
    writeFileSync(join(dir, 'CHANGELOG.md'), '## [0.1.0] — 2026-10-17\nInitial.\n');
    expect(run().status).toBe(0);
    for (const base of ['0.1.0', '0.2.0']) {
      const result = spawnSync(process.execPath, [join(root, 'scripts/release-check.mjs'), '--root', dir], { encoding: 'utf8', env: { ...process.env, RELEASE_BASE_VERSION: base } });
      expect(result.status).toBe(1); expect(result.stderr).toContain('must advance');
    }
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.2.0' }));
    expect(run().stdout + run().stderr).toContain('FAIL version mismatch');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('linked worktree scans staged content, not only its safe working copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-index-'));
  try {
    mkdirSync(join(dir, 'bin')); writeFileSync(join(dir, '.git'), 'gitdir: external'); writeFileSync(join(dir, 'candidate.txt'), 'safe');
    const git = join(dir, 'bin/git'); writeFileSync(git, '#!/bin/sh\ncase "$1" in ls-files|diff) printf "candidate.txt\\0";; show) printf "' + '/' + 'home' + '/example/private";; esac\n'); chmodSync(git, 0o755);
    const result = spawnSync(process.execPath, [join(root, 'scripts/check-structure.mjs'), '--root', dir], { encoding: 'utf8', env: { ...process.env, PATH: join(dir, 'bin') } });
    expect(result.status).toBe(1); expect(result.stderr).toContain('LEAK staged:candidate.txt');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('native gate prerequisites report NOT RUN when claude is missing', async () => {
  const { readFileSync } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'cache-keepwarm-prereq-'));
  try { for (const name of ['test:hooks', 'validate:plugin']) {
    const result = spawnSync('/bin/sh', ['-c', pkg.scripts[name]], { encoding: 'utf8', env: { PATH: dir } });
    expect(result.status).toBe(3); expect(result.stdout).toContain('NOT RUN: missing claude');
  } } finally { rmSync(dir, { recursive: true, force: true }); }
});
