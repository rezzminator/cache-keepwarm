import { expect, test } from 'vitest';
import { pokeMessage, formatLedger, formatOutcome, formatState, formatStopped, formatWaiting, type StatusView } from '../plugins/cache-keepwarm/src/status.ts';
function call<T>(fn: () => T): T | string { try { return fn(); } catch (error) { return String(error); } }
const items = [{ kind: 'agent', label: 'Audit the release notes', firstSeenAt: 0 }, { kind: 'command', label: 'npm test', firstSeenAt: 60000 }];
test('exact waiting examples', () => {
  const input = { items, now: 540000, pokes: { count: 2, max: 4 }, nextInMs: 180000, ttlSource: 'observed' as const };
  const expected = 'cache-keepwarm · waiting on agent "Audit the release notes" +1 more · 9m · pokes 2/4 · next in 3m';
  expect(call(() => formatWaiting(input))).toBe(expected);
  expect(call(() => formatWaiting({ ...input, ttlSource: 'assumed' }))).toBe(expected + ' · TTL assumed 5m');
  expect(call(() => formatWaiting({ ...input, now: 3900000 }))).toContain('1h05m');
});
test.each([
  [{ reason: 'poke-limit', pokes: { count: 4, max: 4 } }, 'stopped: poke limit reached 4/4'],
  [{ reason: 'budget', warms: 10 }, 'stopped: the next warm would cost more than the rewrite it saves (10 warms)'],
  [{ reason: 'late', lateMinutes: 4 }, 'stopped: the cache had already lapsed (timer fired 4m late)'],
  [{ reason: 'ended', item: { kind: 'agent', label: 'X' }, detail: 'killed' }, 'stopped: agent "X" was killed'],
  [{ reason: 'error', detail: 'dropped: busy' }, 'stopped: poke failed (dropped: busy)'],
  [{ reason: 'inactive' }, 'stopped: this Claude Code gives the Stop hook no background_tasks'],
  [{ reason: 'small', context: 19999, minContext: 20000 }, 'not warming: context 19,999 tokens is under the 20,000 minimum'],
  [{ reason: '1h-unproven' }, 'not warming: 1h refresh unproven'],
] as const)('notice %#', (input, text) => expect(call(() => formatStopped(input))).toBe('cache-keepwarm · ' + text));
test('clear, command and ledger share truthful values', () => {
  expect(call(() => formatStopped(undefined))).toBeUndefined();
  const session = { spent: 700, warms: 3, episodes: 1, estimatedNet: 5000, unknown: 0 };
  const ledger = { context: 50000, ttl: '5m' as const, spent: 700, warms: 3, allowance: 57500, protecting: 62500, remaining: 56800 };
  expect(call(() => formatLedger(ledger, session))).toContain('spent ≈ 0.7k-eq');
  expect(call(() => formatLedger(ledger, session))).toContain('protecting ≈ 62.5k-eq rewrite');
  for (const reason of ['off', 'idle', 'cache-cold', 'small', 'budget', 'stale', 'poke-limit', 'poke-failed', 'resumed', '1h-unproven'] as const) {
    const view: StatusView = { enabled: reason !== 'off', source: 'session', reason, items, now: 60000, warms: 3, nextInMs: 1000, ttl: '5m', ttlSource: 'env', context: 50000, ledger, session, lastOutcome: null };
    expect(call(() => formatState(view))).toContain(`[${reason}]`);
    expect(call(() => formatState(view))).toContain('session override');
  }
  expect(call(() => formatOutcome({ elapsedMs: 600000, readPercent: 98, netSaved: 5000, reason: 'estimated' }))).toContain('return read 98.0% from cache · estimated net saved ≈ 5k-eq');
  expect(call(() => formatOutcome({ elapsedMs: 0, readPercent: null, netSaved: null, reason: 'unknown' }))).toContain('unknown');
});

test('empty status names no current wait exactly once', () => {
  const view: StatusView = { enabled: true, source: 'launch', reason: 'typing', items: [], now: 0, warms: 0, nextInMs: 0, ttl: '5m', ttlSource: 'assumed', context: 50000, ledger: null, session: { spent: 0, warms: 0, episodes: 0, estimatedNet: 0, unknown: 0 }, lastOutcome: null };
  expect(formatState(view).match(/no current wait/g)).toHaveLength(1);
});

test('/keepwarm names a reached poke limit with its count', () => {
  const view: StatusView = { enabled: true, source: 'launch', reason: 'poke-limit', pokes: { count: 4, max: 4 }, items, now: 60000, warms: 4, nextInMs: 0, ttl: '5m', ttlSource: 'env', context: 50000, ledger: null, session: { spent: 0, warms: 0, episodes: 0, estimatedNet: 0, unknown: 0 }, lastOutcome: null };
  expect(call(() => formatState(view))).toContain('stopped: poke limit reached 4/4 [poke-limit]');
});
const head = 'Keep-warm poke 1/4: your prompt cache was about to expire, so this message keeps it warm while you wait on:\n';
const tail = '\nIf any of these is stale or was started by accident, stop it now. Otherwise reply `waiting` and end your turn.';
test('the poke names one pending item by kind, real id, sanitized label and elapsed time', () => {
  expect(call(() => pokeMessage({ n: 1, max: 4, now: 240000, items: [{ id: 'a46e2aabaedd0967e', kind: 'agent', label: 'Audit the release notes', firstSeenAt: 0 }] })))
    .toBe(head + '- agent `a46e2aabaedd0967e`: Audit the release notes, pending 4m' + tail);
});
test('the poke lists several items, one bullet each, with the Monitor kind spelled as the tool', () => {
  const several = [
    { id: 'a46e2aabaedd0967e', kind: 'agent', label: 'Audit', firstSeenAt: 0 }, { id: 'bnlqavl3a', kind: 'command', label: 'sleep 540', firstSeenAt: 60000 },
    { id: 'm1', kind: 'monitor', label: 'Monitor', firstSeenAt: 120000 }, { id: 'w1', kind: 'workflow', label: 'Checks', firstSeenAt: 0 },
  ];
  expect(call(() => pokeMessage({ n: 3, max: 5, now: 3900000, items: several }))).toBe(head.replace('1/4', '3/5') + [
    '- agent `a46e2aabaedd0967e`: Audit, pending 1h05m', '- command `bnlqavl3a`: sleep 540, pending 1h04m', '- Monitor `m1`: Monitor, pending 1h03m', '- workflow `w1`: Checks, pending 1h05m',
  ].join('\n') + tail);
});
