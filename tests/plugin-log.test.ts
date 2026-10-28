import { expect, test } from 'vitest';
import { levelRow, pluginLogDir, PluginLogQueue, ROW_MAX_BYTES } from '../plugins/cache-keepwarm/src/plugin-log.ts';

test('the directory is PLUGIN_LOG_DIR/{plugin}, else the home fallback, else none', () => {
  expect(pluginLogDir('/shared/', '/h', 'cache-keepwarm')).toBe('/shared/cache-keepwarm');
  expect(pluginLogDir('', '/h/', 'cache-keepwarm')).toBe('/h/.local/state/cache-keepwarm/logs');
  expect(pluginLogDir(undefined, '', 'cache-keepwarm')).toBeUndefined();
});
test('a row keeps the contract key order and its bound', () => {
  const small = JSON.parse(levelRow({ plugin: 'p', level: 'info', event: 'e', msg: 'm', where: 'w', session: 's', detail: { a: 1 } }, 0));
  expect(Object.keys(small)).toEqual(['ts', 'plugin', 'level', 'event', 'msg', 'where', 'session', 'detail']);
  const noSession = JSON.parse(levelRow({ plugin: 'p', level: 'error', event: 'e', msg: 'm', where: 'w' }, 0));
  expect(Object.keys(noSession)).toEqual(['ts', 'plugin', 'level', 'event', 'msg', 'where', 'detail']);
  const big = levelRow({ plugin: 'p', level: 'warning', event: 'e', msg: 'é'.repeat(9000), where: 'w', detail: { x: 'y'.repeat(9000) } }, 0);
  expect(Buffer.byteLength(big)).toBeLessThanOrEqual(ROW_MAX_BYTES); expect(big.endsWith('\n')).toBe(true);
  expect(JSON.parse(big).detail).toMatchObject({ truncated: true });
});
test('the screen line is said once per failing streak and re-armed by a success', async () => {
  const q = new PluginLogQueue('/d/p', 'p'), lines: string[] = [];
  const row = levelRow({ plugin: 'p', level: 'info', event: 'e', msg: 'm', where: 'w' }, 0);
  const bad = async () => ({ exitCode: 1, stdout: '', stderr: 'no space' }), good = async () => ({ exitCode: 0, stdout: '', stderr: '' });
  for (const run of [bad, bad, good, bad]) { q.add(row); await q.flush(run, line => lines.push(line)); }
  expect(lines).toHaveLength(2); expect(lines[0]).toContain('no space');
  const off = new PluginLogQueue(undefined, 'p'); off.add(row); const result = await off.flush(good, line => lines.push(line));
  expect(result.dropped).toBe(1); expect(lines.at(-1)).toContain('off');
});
