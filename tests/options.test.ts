import { expect, test } from 'vitest';
import { URL } from 'node:url';
import { resolveOptions } from '../plugins/cache-keepwarm/src/options.ts';
const defaults = { enabled: true, minContext: 20000, maxPokes: 4, subagentMinContext: 100000, subagents: true, status: true, bad: [] };
test.each([
  [{}, {}, defaults],
  [{ subagents: false }, {}, { ...defaults, subagents: false }],
  [{ subagents: false }, { CACHE_KEEPWARM_SUBAGENTS: 'TrUe' }, { ...defaults, subagents: true }],
  [{ subagents: false }, { CACHE_KEEPWARM_SUBAGENTS: 'bad' }, { ...defaults, subagents: true, bad: ['CACHE_KEEPWARM_SUBAGENTS'] }],
  [{ minContext: 50000 }, { CACHE_KEEPWARM_MIN_CONTEXT: '30000' }, { ...defaults, minContext: 30000 }],
  [{}, { CACHE_KEEPWARM_ENABLED: 'FALSE' }, { ...defaults, enabled: false }],
  [{ maxPokes: 6 }, {}, { ...defaults, maxPokes: 6 }], [{ maxPokes: 6 }, { CACHE_KEEPWARM_MAX_POKES: '2' }, { ...defaults, maxPokes: 2 }],
  [{ maxPokes: 6 }, { CACHE_KEEPWARM_MAX_POKES: '0' }, { ...defaults, bad: ['CACHE_KEEPWARM_MAX_POKES'] }],
  [{ maxPokes: 0 }, {}, { ...defaults, bad: ['maxPokes'] }], [{ maxPokes: 1.5 }, {}, { ...defaults, bad: ['maxPokes'] }], [{ maxPokes: 1 }, {}, { ...defaults, maxPokes: 1 }],
  [{ subagentMinContext: 50000 }, { CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT: '0' }, { ...defaults, subagentMinContext: 0 }],
  [{}, { CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT: '-1' }, { ...defaults, bad: ['CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT'] }],
  [{}, { CACHE_KEEPWARM_SUBAGENTS: '0' }, { ...defaults, subagents: false }],
  [{ status: false }, {}, { ...defaults, status: false }], [{}, { CACHE_KEEPWARM_STATUS: '0' }, { ...defaults, status: false }],
  [{ status: false }, { CACHE_KEEPWARM_STATUS: 'bad' }, { ...defaults, bad: ['CACHE_KEEPWARM_STATUS'] }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '  ' }, defaults],
  [{ enabled: false, minContext: 1, maxPokes: 1, subagentMinContext: 1 }, {}, { ...defaults, enabled: false, minContext: 1, maxPokes: 1, subagentMinContext: 1 }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '-1', CACHE_KEEPWARM_ENABLED: 'yes' }, { ...defaults, bad: ['CACHE_KEEPWARM_ENABLED', 'CACHE_KEEPWARM_MIN_CONTEXT'] }],
  [{}, { CACHE_KEEPWARM_MIN_CONTEXT: '1.5', CACHE_KEEPWARM_MAX_POKES: 'Infinity' }, { ...defaults, bad: ['CACHE_KEEPWARM_MIN_CONTEXT', 'CACHE_KEEPWARM_MAX_POKES'] }],
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
