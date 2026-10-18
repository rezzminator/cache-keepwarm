import { expect, test } from 'vitest';
import { compactFacts, compactResets } from '../plugins/cache-keepwarm/src/compact.ts';
test.each([
  [{ trigger: 'auto' }, { trigger: 'auto' }], [{ trigger: 'manual', agentId: 'sub' }, { trigger: 'manual', agentId: 'sub' }],
  [{ trigger: 'precompute', agentId: '' }, { trigger: 'precompute' }], [{}, { trigger: 'unknown' }], [{ trigger: 'later', agentId: 7 }, { trigger: 'unknown' }],
])('compact metadata %# keeps only a known trigger and a real agentId', (input, facts) => expect(compactFacts(input)).toEqual(facts));
test.each([['precompute', false], ['auto', true], ['manual', true], ['plugin', true], ['unknown', true]] as const)('a %s compaction resets anchors: %s', (trigger, resets) => {
  expect(compactResets({ trigger })).toBe(resets); expect(compactResets({ trigger, agentId: 'sub' })).toBe(resets);
});
