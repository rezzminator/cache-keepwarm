import { expect, test } from 'vitest';
import { decideWarm, type DecisionInput } from '../plugins/cache-keepwarm/src/decision.ts';
const item = { id: 'a', expired: false, leaseEndsAt: 10800000, expectedBackAt: null, wake: 'yes' as const };
const base: DecisionInput = { enabled: true, busy: false, typing: false, currentEpoch: true, inFlight: false, known: true, context: 50000, minContext: 20000, lastSendAt: 0, now: 240000, ttl: '5m', warm1h: false, items: [item], spent: 0, forecast: 8000, saved: 57500 };
test.each([
  [{}, 'warm', 'eligible'], [{ enabled: false }, 'stop', 'off'], [{ busy: true }, 'stop', 'busy'],
  [{ typing: true }, 'stop', 'typing'], [{ currentEpoch: false }, 'stop', 'stale'], [{ inFlight: true }, 'skip', 'in-flight'],
  [{ known: false }, 'stop', 'inventory-unknown'], [{ items: [] }, 'stop', 'nothing-pending'], [{ items: [], endedId: 'a' }, 'stop', 'ended'],
  [{ context: null }, 'stop', 'usage-unknown'], [{ context: NaN }, 'stop', 'usage-invalid'], [{ context: 19999 }, 'stop', 'small'],
  [{ lastSendAt: null }, 'stop', 'usage-unknown'], [{ ttl: '1h' }, 'stop', '1h-unproven'],
  [{ now: 300000 }, 'stop', 'cache-cold'], [{ now: 299999 }, 'stop', 'expiry-safety'], [{ now: 285000 }, 'stop', 'expiry-safety'],
  [{ now: 284999 }, 'warm', 'eligible'], [{ items: [{ ...item, wake: 'unknown' }] }, 'stop', 'wake-unknown'],
  [{ items: [{ ...item, wake: 'no' }] }, 'stop', 'cannot-wake'], [{ items: [{ ...item, expired: true }] }, 'stop', 'lease'],
  [{ items: [{ ...item, leaseEndsAt: 300000 }] }, 'stop', 'wait-window-short'],
  [{ items: [{ ...item, expectedBackAt: 299999 }] }, 'skip', 'imminent'],
  [{ items: [{ ...item, expectedBackAt: 300000 }] }, 'skip', 'imminent'],
  [{ spent: 50000 }, 'stop', 'budget'], [{ spent: 49000 }, 'stop', 'marginal'], [{ spent: 48700 }, 'warm', 'eligible'],
  [{ items: [{ ...item, expired: true }, { ...item, id: 'b' }] }, 'warm', 'eligible'],
  [{ items: [{ ...item, expectedBackAt: 100 }, { ...item, id: 'b' }] }, 'warm', 'eligible'],
  [{ now: -1 }, 'stop', 'usage-invalid'], [{ forecast: Infinity }, 'stop', 'usage-invalid'],
] as const)('decision %# %s', (patch, action, reason) => {
  let actual: unknown; try { actual = decideWarm({ ...base, ...patch } as DecisionInput); } catch (error) { actual = { reason: String(error) }; }
  expect(actual).toMatchObject({ action, reason });
});
test('expired siblings do not justify a surviving warm', () => expect(decideWarm({ ...base, items: [{ ...item, expired: true }, { ...item, id: 'b' }] }).items).toEqual(['b']));
test.each(['fork-failed', 'timer-failed'] as const)('pure settlement stop %s', fault => {
  expect(decideWarm({ ...base, fault } as DecisionInput)).toMatchObject({ action: 'stop', reason: fault });
});

test('lease stop names the oldest expired wait independent of roster ordering', () => {
  expect(decideWarm({ ...base, items: [{ ...item, id: 'newer', expired: true, leaseEndsAt: 200000 }, { ...item, id: 'oldest', expired: true, leaseEndsAt: 100000 }] })).toMatchObject({ reason: 'lease', itemId: 'oldest' });
});
