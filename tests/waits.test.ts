import { expect, test } from 'vitest';
import { firstSeen, fromStop, leaseExpired, reconcile, sanitizeLabel, type TaskSummary } from '../plugins/cache-keepwarm/src/waits.ts';
function call<T>(fn: () => T): T | string { try { return fn(); } catch (error) { return String(error); } }
test('snapshot forms and sanitized producer labels', () => {
  const tasks = [
    { id: 'a46e2aabaedd0967e', type: 'subagent', status: 'running', description: 'Cache experiment long background probe' },
    { id: 'bnlqavl3a', type: 'shell', status: 'running', description: 'probe', command: `python3 -c 'import time; time.sleep(755); print("LONG_PROBE_DONE")'` },
    { id: 'm', type: 'monitor', status: 'running', description: 'watch' },
    { id: 'w', type: 'workflow', status: 'running', description: 'flow' },
    { id: 'u', type: 'future', status: 'running', description: 'unknown' },
    { id: 'd', type: 'subagent', status: 'completed', description: 'done' },
  ] as TaskSummary[];
  expect(call(() => fromStop(tasks, 1))).toEqual({ known: true, items: [
    { id: 'a46e2aabaedd0967e', kind: 'agent', label: 'Cache experiment long background probe' },
    { id: 'bnlqavl3a', kind: 'command', label: `python3 -c 'import time; time.sleep(755)…` },
    { id: 'm', kind: 'monitor', label: 'watch' }, { id: 'w', kind: 'workflow', label: 'flow' },
    { id: 'u', kind: 'future', label: 'unknown' },
  ], ended: [{ item: { id: 'd', kind: 'agent', label: 'done' }, ended: 'completed' }] });
  expect(call(() => fromStop(undefined, 0))).toEqual({ known: false, items: [] });
  expect(call(() => fromStop([], 0))).toEqual({ known: true, items: [] });
  expect(call(() => sanitizeLabel('a\u0007b\n\n  c' + 'x'.repeat(60)))).toBe('ab cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…');
  expect(call(() => sanitizeLabel('\u001b[31mred\u001b[0m'))).toBe('[31mred[0m');
});
test('terminal refinement and independent earliest leases', () => {
  const items = [{ id: 'a', kind: 'agent', label: 'X' }, { id: 'b', kind: 'command', label: 'Y' }];
  for (const status of ['killed', 'completed', 'failed'] as const) {
    expect(call(() => reconcile(items, [{ id: 'a', status }]))).toEqual({ items: [items[1]], ended: [{ item: items[0], ended: status }] });
  }
  for (const status of ['pending', 'running', 'waiting', 'idle'] as const) expect(call(() => reconcile(items, [{ id: 'a', status }]))).toEqual({ items, ended: [] });
  expect(call(() => reconcile(items, []))).toEqual({ items, ended: [] });
  expect(call(() => firstSeen(items, new Map([['a', 1], ['gone', 2]]), 3))).toEqual(new Map([['a', 1], ['b', 3]]));
  expect(call(() => leaseExpired({ firstSeenAt: 1792247410124, maxWaitMinutes: 180, now: 1792258210124 }))).toBe(true);
  expect(call(() => leaseExpired({ firstSeenAt: 1792247410124, maxWaitMinutes: 180, now: 1792258210123 }))).toBe(false);
});
