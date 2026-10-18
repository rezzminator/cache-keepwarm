import { expect, test } from 'vitest';
import { URL } from 'node:url';
import { resolveOptions } from '../plugins/cache-keepwarm/src/options.ts';
const defaults = { enabled: true, minContext: 20000, maxWaitMinutes: 180, logDir: '', band: true, subagents: false, bad: [] };
test.each([
  [{}, {}, defaults],
  [{ subagents: false }, {}, { ...defaults, subagents: false }],
  [{ subagents: false }, { CACHE_KEEPWARM_SUBAGENTS: 'TrUe' }, { ...defaults, subagents: true }],
  [{ subagents: false }, { CACHE_KEEPWARM_SUBAGENTS: 'bad' }, { ...defaults, bad: ['CACHE_KEEPWARM_SUBAGENTS'] }],
  [{ minContext: 50000 }, { CACHE_KEEPWARM_MIN_CONTEXT: '30000' }, { ...defaults, minContext: 30000 }],
  [{}, { CACHE_KEEPWARM_ENABLED: 'FALSE', CACHE_KEEPWARM_BAND: '0' }, { ...defaults, enabled: false, band: false }],
  [{ maxWaitMinutes: 60 }, { CACHE_KEEPWARM_MAX_WAIT_MINUTES: 'abc' }, { ...defaults, bad: ['CACHE_KEEPWARM_MAX_WAIT_MINUTES'] }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '  ' }, defaults],
  [{ enabled: false, band: false, logDir: 'logs', minContext: 1, maxWaitMinutes: 1 }, {}, { ...defaults, enabled: false, band: false, logDir: 'logs', minContext: 1, maxWaitMinutes: 1 }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '-1', CACHE_KEEPWARM_ENABLED: 'yes', CACHE_KEEPWARM_BAND: 'junk' }, { ...defaults, bad: ['CACHE_KEEPWARM_ENABLED', 'CACHE_KEEPWARM_MIN_CONTEXT', 'CACHE_KEEPWARM_BAND'] }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '1.5', CACHE_KEEPWARM_MAX_WAIT_MINUTES: 'Infinity' }, { ...defaults, bad: ['CACHE_KEEPWARM_MIN_CONTEXT', 'CACHE_KEEPWARM_MAX_WAIT_MINUTES'] }],
] as const)('resolves options %#', (options, env, expected) => {
  let actual: unknown; try { actual = resolveOptions(options, env); } catch (error) { actual = String(error); }
  expect(actual).toEqual(expected);
});

test('installed userConfig matches runtime option defaults and all option names', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../plugins/cache-keepwarm/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const { bad, ...runtime } = resolveOptions({}, {});
  expect(Object.fromEntries(Object.entries(manifest.userConfig).map(([key, value]: [string, any]) => [key, value.default]))).toEqual(runtime);
});
