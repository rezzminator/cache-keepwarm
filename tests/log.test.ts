import { expect, test } from 'vitest';
import { appendLog, logFileName, logBase, leafRefusal, type LogRow } from '../plugins/cache-keepwarm/src/log.ts';
test('bounded metadata buffer excludes arbitrary producer secrets', () => {
  const row = { at: 1, event: 'decision', epoch: 0, items: [{ id: 'a', kind: 'agent', label: 'sk-test-123' }], ttl: '5m', ttlSource: 'assumed', context: 50000, spent: 0, reason: 'eligible', secret: 'sk-test-123' } as unknown as LogRow;
  let actual: unknown; try { actual = appendLog(Array.from({ length: 500 }, (_, at) => ({ ...row, at })), row); } catch (error) { actual = String(error); }
  expect(Array.isArray(actual)).toBe(true);
  const rows = actual as LogRow[];
  expect(rows).toHaveLength(500);
  expect(rows[0]?.at).toBe(1);
  expect(JSON.stringify(rows)).not.toContain('sk-test-123');
  expect(rows.at(-1)).toEqual({ at: 1, event: 'decision', epoch: 0, items: [{ id: 'a', kind: 'agent' }], ttl: '5m', ttlSource: 'assumed', context: 50000, spent: 0, reason: 'eligible' });
});
test('log file names carry the encoded session and this process instance', () => {
  let actual: unknown; try { actual = logFileName('a/b c', 'f00d'); } catch (error) { actual = String(error); }
  expect(actual).toBe('a%2Fb%20c.f00d.jsonl');
});
test.each([
  [{ dir: 'logs', stat: null, pinned: null }, { ok: true, base: 'logs', pinned: null }],
  [{ dir: 'logs', stat: { kind: 'dir', isLink: false, realPath: '/w/logs' }, pinned: null }, { ok: true, base: '/w/logs', pinned: '/w/logs' }],
  [{ dir: 'logs', stat: { kind: 'dir', isLink: false, realPath: '/w/logs' }, pinned: '/w/logs' }, { ok: true, base: '/w/logs', pinned: '/w/logs' }],
  [{ dir: 'logs', stat: { kind: 'dir', isLink: true, realPath: '/elsewhere' }, pinned: '/w/logs' }, { ok: false, reason: 'log directory moved' }],
  [{ dir: 'logs', stat: null, pinned: '/w/logs' }, { ok: false, reason: 'log directory moved' }],
  [{ dir: 'logs', stat: { kind: 'file', isLink: false, realPath: '/w/logs' }, pinned: null }, { ok: false, reason: 'log directory is not a directory' }],
  [{ dir: 'logs', stat: { kind: 'dir', isLink: false }, pinned: null }, { ok: false, reason: 'log directory unresolved' }],
] as const)('log base %#', (input, expected) => {
  let actual: unknown; try { actual = logBase(input as Parameters<typeof logBase>[0]); } catch (error) { actual = String(error); }
  expect(actual).toEqual(expected);
});
test.each([
  [null, null], [{ kind: 'file', isLink: false }, null],
  [{ kind: 'file', isLink: true }, 'log target is a link or not a regular file'],
  [{ kind: 'other', isLink: false }, 'log target is a link or not a regular file'],
  [{ kind: 'dir', isLink: false }, 'log target is a link or not a regular file'],
] as const)('log leaf %#', (stat, expected) => {
  let actual: unknown; try { actual = leafRefusal(stat); } catch (error) { actual = String(error); }
  expect(actual).toBe(expected);
});
