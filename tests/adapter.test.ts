import { expect, test } from 'vitest';
import { Harness, pokeText as poke } from './stand-in.ts';
test('loads native controls, arms once, pokes the main chat visibly and accounts actual spend', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  expect(h.loadError).toBeUndefined(); expect(h.pending).toHaveLength(1);
  expect(h.pending[0]?.at).toBe(1792247650124); expect(h.status).toContain('waiting on agent'); expect(h.status).toContain('pokes 0/4');
  await h.advance(240000);
  expect(h.lists).toBe(1); expect(h.submits).toEqual([{ text: poke('1/4', '- agent `a`: Audit sk-test-123, pending 4m') }]);
  await h.pokeReply(); expect(h.pending).toHaveLength(1); expect(h.pending[0]?.at).toBe(h.now + 240000);
  expect(h.status).toContain('pokes 1/4'); expect(h.rows().some((r: any) => r.event === 'poke' && r.spent === 6628.5)).toBe(true);
  expect(JSON.stringify(h.rows())).not.toContain('sk-test-123');
  expect(h.commands).toMatchObject([{ name: 'keepwarm', immediate: true, argumentHint: '[on|off|status]' }]);
});
test.each(['stop-first', 'complete-first'])('a poke and its own reply are not activity, in either hook order: %s', async order => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.advance(240000);
  await h.pokeReply({ order }); expect(h.pending).toHaveLength(1); expect(h.pending[0]?.at).toBe(h.now + 240000);
  const text = (await h.command('status')).text; expect(text).toContain('session 1 warms'); expect(text).not.toContain('last:');
  await h.advance(240000); expect(h.submits.at(-1)!.text).toBe(poke('2/4', '- agent `a`: Audit sk-test-123, pending 8m'));
});
test('the cap stops at N pokes on an unchanged wait and says so in the status, /keepwarm and the log', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs', CACHE_KEEPWARM_MAX_POKES: '2' }); await h.arm();
  await h.advance(240000); await h.pokeReply(); await h.advance(240000); await h.pokeReply();
  expect(h.submits.map(s => s.text.slice(0, 19))).toEqual(['Keep-warm poke 1/2:', 'Keep-warm poke 2/2:']);
  expect(h.pending).toHaveLength(0); expect(h.status).toContain('poke limit reached 2/2');
  expect((await h.command('status')).text).toContain('poke limit reached 2/2');
  expect(h.rows().some((r: any) => r.reason === 'poke-limit' && r.pokes?.count === 2 && r.pokes?.max === 2)).toBe(true);
  await h.advance(900000); expect(h.submits).toHaveLength(2);
});
test.each(['prompt', 'turn', 'notification'])('real activity (%s) after a reached limit gives the wait fresh pokes', async kind => {
  const h = new Harness({}, { CACHE_KEEPWARM_MAX_POKES: '1' }); await h.arm(); await h.advance(240000); await h.pokeReply();
  expect(h.status).toContain('poke limit reached 1/1');
  if (kind === 'prompt') await h.emit('prompt.submit', { text: 'Go on', origin: { kind: 'composer' } });
  if (kind === 'notification') await h.emit('session.receive', { text: '<task-notification>progress</task-notification>', origin: { kind: 'task-notification' } });
  await h.step(); await h.stop(); await h.advance(240000);
  expect(h.submits).toHaveLength(2); expect(h.submits[1]!.text.startsWith('Keep-warm poke 1/1:')).toBe(true);
});
test.each([
  ['ended', [{ id: 'a', type: 'subagent', status: 'running', description: 'A' }, { id: 'b', type: 'shell', status: 'completed', description: 'B', command: 'b' }], '- agent `a`: A, pending 8m'],
  ['new-item', [{ id: 'a', type: 'subagent', status: 'running', description: 'A' }, { id: 'b', type: 'shell', status: 'running', description: 'B', command: 'b' }, { id: 'c', type: 'monitor', status: 'running', description: 'C' }], '- agent `a`: A, pending 8m\n- command `b`: b, pending 8m\n- Monitor `c`: C, pending 4m'],
] as const)('a changed id set (%s) is a fresh key with its own count', async (_kind, after, bullets) => {
  const h = new Harness({}, { CACHE_KEEPWARM_MAX_POKES: '2' }); await h.start(); await h.step();
  await h.stop([{ id: 'a', type: 'subagent', status: 'running', description: 'A' }, { id: 'b', type: 'shell', status: 'running', description: 'B', command: 'b' }]);
  await h.advance(240000); await h.pokeReply({ tasks: after }); await h.advance(240000);
  expect(h.submits.at(-1)!.text).toBe(poke('1/2', bullets));
});
test('a later different wait in a long-lived chat gets its own N pokes', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_MAX_POKES: '1' }); await h.arm(); await h.advance(240000); await h.pokeReply();
  await h.emit('session.receive', { text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' } }); await h.step();
  const later = [{ id: 'later', type: 'shell', status: 'running', description: 'Later', command: 'sleep 900' }]; await h.stop(later); await h.advance(240000);
  expect(h.submits.at(-1)!.text).toBe(poke('1/1', '- command `later`: sleep 900, pending 4m')); await h.pokeReply({ tasks: later });
  expect(h.status).toContain('poke limit reached 1/1');
});
test('the poke turn is recognised by its start alone when the calling hook skips its own submit', async () => {
  const h = new Harness(); await h.arm(); await h.advance(240000); await h.pokeReply({ hook: false });
  expect(h.pending).toHaveLength(1); expect((await h.command('status')).text).toContain('session 1 warms');
});
test.each(['prompt.submit', 'prompt.edit', 'prompt.change', 'session.receive', 'session.compact', 'classic.PostModelSwitch', 'session.end'])('cancel on %s wins', async event => {
  const h = new Harness(); await h.arm(); expect(h.pending).toHaveLength(1); await h.emit(event, { text: 'draft', origin: { kind: 'composer' } });
  expect(h.pending).toHaveLength(0); expect(h.status).toBeUndefined(); await h.advance(400000); expect(h.submits).toHaveLength(0);
});
test('main step cancels but agent step and agent delivery do not', async () => {
  const h = new Harness(); await h.arm(); await h.step(undefined, 'sub'); await h.emit('session.receive', { agentId: 'sub' });
  expect(h.pending).toHaveLength(1); await h.step(); expect(h.pending).toHaveLength(0); expect(h.status).toBeUndefined();
});
test.each(['drop', 'throw', 'aborted', 'usage-missing'])('poke failure %s never retries', async kind => {
  const h = new Harness(); await h.arm();
  if (kind === 'drop') h.submitImpl = async () => ({ drop: 'refused by a hook' });
  if (kind === 'throw') h.submitImpl = async () => { throw new Error('boom'); };
  await h.advance(240000); expect(h.submits).toHaveLength(1);
  if (kind === 'aborted') await h.pokeReply({ reason: 'aborted' }); if (kind === 'usage-missing') await h.pokeReply({ usage: null });
  expect(h.pending).toHaveLength(0);
  expect(h.status).toContain({ drop: 'poke failed (dropped: refused by a hook)', throw: 'poke failed (threw: boom)', aborted: 'poke failed (aborted)', 'usage-missing': 'poke failed (usage unknown)' }[kind]);
  await h.advance(900000); expect(h.submits).toHaveLength(1);
});
test('commands override launch default but on never arms until next Stop', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_ENABLED: '0' }); await h.arm();
  expect(h.pending).toHaveLength(0); expect(h.status).toBeUndefined();
  expect((await h.command('status'))?.text).toContain('off (launch default)');
  expect((await h.command('on'))?.text).toContain('on (session override)'); expect(h.pending).toHaveLength(0);
  await h.stop(); expect(h.pending).toHaveLength(1); await h.command('off'); expect(h.pending).toHaveLength(0);
  expect((await h.command('bad'))?.text).toContain('Usage: /keepwarm');
  await h.start(); expect((await h.command('status'))?.text).toContain('off (launch default)');
});
test('draft, terminal refinement and missing native inventory refuse visibly', async () => {
  for (const kind of ['draft', 'ended', 'missing'] as const) {
    const h = new Harness(); await h.start();
    await h.step();
    if (kind === 'draft') h.draft = 'typing'; if (kind === 'ended') h.agents[0]!.status = 'killed';
    if (kind === 'missing') await h.emit('classic.Stop', {}); else await h.stop([{ id: 'a', type: 'subagent', status: 'running', description: 'X' }]);
    if (kind === 'ended') await h.advance(240000);
    expect(h.submits).toHaveLength(0); expect(h.pending).toHaveLength(0);
    expect(h.status).toContain({ draft: 'typing', ended: 'killed', missing: 'background_tasks' }[kind]);
  }
});
test('log rejection is visible once and does not prevent warming', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); h.writeError = new Error('disk full'); await h.arm(); await h.advance(240000);
  expect(h.submits).toHaveLength(1); expect(h.status).toContain('log write failed'); expect((await h.command('status')).text).toContain('log write failed');
});
test('same session restore shows age, but no grant; zero cache step invalidates', async () => {
  const h = new Harness(); await h.arm(); const entries = new Map(h.values);
  const resumed = new Harness(); resumed.values = entries; resumed.now = h.now + 1000; await resumed.start();
  expect((await resumed.command('status'))?.text).toContain('[resumed]'); expect(resumed.pending).toHaveLength(0);
  await resumed.step({ input_tokens: 50000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'haiku' }); await resumed.stop();
  expect(resumed.pending).toHaveLength(0); expect(resumed.status).toContain('no main request');
});
test('a resumed session paints no status line, while /keepwarm status still says resumed', async () => {
  const h = new Harness(); await h.arm(); const entries = new Map(h.values);
  const resumed = new Harness(); resumed.values = entries; resumed.now = h.now + 1000; await resumed.start();
  expect(resumed.statuses.length).toBeGreaterThan(0); expect(resumed.status).toBeUndefined(); expect(resumed.statuses.filter(Boolean).join(' ')).not.toContain('resumed');
  expect((await resumed.command('status'))?.text).toContain('[resumed]');
});
test('empty programmatic draft changes preserve the grant; repeated Stop retains spend', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  await h.emit('prompt.change', { text: '', cursor: 0, origin: 'plugin' }); expect(h.pending).toHaveLength(1);
  await h.advance(240000); await h.pokeReply(); await h.stop();
  expect((await h.command('status'))?.text).toContain('spent ≈ 6.6k-eq');
});
test('optional queued disk logging cannot delay primary input', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  let release!: () => void; h.writeImpl = () => new Promise<void>(resolve => { release = resolve; });
  const firing = h.advance(240000); await h.settle();
  let forwarded = false; const input = h.emit('prompt.submit', {}).then(() => { forwarded = true; });
  await h.settle(); const before = forwarded; h.writeImpl = null; release(); await firing; await input;
  expect(before).toBe(true); expect(h.pending).toHaveLength(0);
});
test('clear resets session override and numeric ledger without another start', async () => {
  const h = new Harness(); await h.arm(); await h.advance(240000); await h.pokeReply(); await h.command('off');
  await h.emit('session.end', { reason: 'clear' }, { sessionId: 'session-2' });
  expect((await h.command('status'))?.text).toContain('on (launch default)');
  expect((await h.command('status'))?.text).toContain('session 0 warms');
});
// Reachable native-operation interleavings, not elapsed-time sleeps.
test('slow admission preparation cannot send at or beyond the safety deadline', async () => {
  const h = new Harness(); await h.arm();
  h.engine.agent.list = async () => { h.now += 60000; return h.agents as any; };
  await h.advance(240000);
  expect(h.submits).toHaveLength(0); expect(h.status).toContain('cache cold');
});
test('a stale preparing fire never submits once a newer wait replaced it', async () => {
  const h = new Harness(); await h.arm();
  let releaseList!: (value: any) => void;
  h.engine.agent.list = () => new Promise(resolve => { releaseList = resolve; });
  await h.advance(240000); h.engine.agent.list = async () => h.agents as any;
  await h.step(); await h.stop(); releaseList(h.agents); await h.settle();
  expect(h.submits).toHaveLength(0); await h.advance(240000); expect(h.submits).toHaveLength(1);
});
test.each(['session.compact', 'classic.PostModelSwitch', 'session.end'])('old main response cannot restore an invalidated prefix after %s', async event => {
  const h = new Harness(); await h.arm(); const fn = h.handlers.get('turn.step')![0]!.fn;
  const result = { usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } };
  const stream = fn(h.engine, {}, async function* () { yield 'held'; return result; });
  await stream.next(); await h.emit(event, { reason: 'clear' }, { sessionId: 'new-session' }); await stream.next(); await h.stop();
  expect(h.pending).toHaveLength(0); expect((await h.command('status')).text).toContain('no main request');
});
test('agent-list failure keeps tracked work and reports refinement failure without failing a poke', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  h.engine.agent.list = async () => { throw new Error('roster unavailable'); }; await h.advance(240000);
  expect(h.submits).toHaveLength(1); expect(h.rows().some((r: any) => r.event === 'agent-list-failed')).toBe(true);
});
test.each(['clear', 'resume'])('continuing %s separates identity, rows and observed TTL', async reason => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.advance(240000); await h.pokeReply();
  h.id = 'session-2'; await h.emit('session.end', { reason }, { sessionId: h.id }); await h.step(); await h.stop();
  expect(h.snapshot('session-2')).toBeDefined();
  expect(h.rows().some((r: any) => r.event === 'poke')).toBe(false); expect(h.status).toContain('waiting on');
});
test('bad launch variables remain observable after normal status painting', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_MAX_POKES: 'bad' }); await h.arm();
  expect(h.status).toContain('CACHE_KEEPWARM_MAX_POKES'); expect((await h.command('status')).text).toContain('CACHE_KEEPWARM_MAX_POKES');
  expect(h.status).toContain('pokes 0/4');
});
test('status off paints no waiting text, while a bad option stays visible', async () => {
  const h = new Harness({ status: false }); await h.arm();
  expect(h.pending).toHaveLength(1); expect(h.statuses.filter(Boolean)).toEqual([]);
  const bad = new Harness({ status: false }, { CACHE_KEEPWARM_MAX_POKES: 'bad' }); await bad.arm();
  expect(bad.status).toContain('CACHE_KEEPWARM_MAX_POKES'); expect(bad.status).not.toContain('waiting on');
});
test('a poke completing after its session ended is never charged into the next one', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.advance(240000);
  h.id = 'session-2'; await h.emit('session.end', { reason: 'clear' }, { sessionId: h.id });
  await h.emit('turn.complete', { turnId: 'poke-1', reason: 'answer', durationMs: 100, usage: h.pokeUsage, answer: 'waiting' });
  expect((await h.command('status')).text).toContain('session 0 warms');
});
const enoent = (path: string) => { throw new Error(`ENOENT: no such file or directory, stat '${path}'`); };
test('a link or special file at the log target is refused visibly and never written', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' });
  h.statImpl = async path => path.endsWith('.jsonl') ? { kind: 'other', isLink: true, size: 0, mtimeMs: 0 } : enoent(path);
  await h.arm(); await h.advance(240000);
  expect(h.submits).toHaveLength(1); expect(h.writes).toHaveLength(0);
  expect(h.status).toContain('log write refused (log target is a link or not a regular file)');
});
test('a log directory moved after the first write is refused, and writes land under the pinned real path', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); let stats = 0;
  h.statImpl = async path => path === 'logs' ? { kind: 'dir', isLink: false, size: 0, mtimeMs: 0, realPath: stats++ === 0 ? '/w/logs' : '/w/moved' } : enoent(path);
  await h.arm();
  expect(h.paths).toHaveLength(1); expect(h.paths[0]).toMatch(/^\/w\/logs\/session-1\.[0-9a-f-]{36}\.jsonl$/);
  expect(h.status).toContain('log write refused (log directory moved)');
});
test('two processes on one session keep both actors\' snapshots; a later resume restores the newest', async () => {
  const shared = new Map<string, unknown>();
  const a = new Harness(); a.values = shared; await a.arm(); await a.advance(240000); await a.pokeReply();
  const b = new Harness(); b.values = shared; b.now = a.now + 1000; await b.start(); await b.step(); await b.stop(); await b.advance(240000); await b.pokeReply();
  const actors = [...shared.entries()].filter(([key]) => key.startsWith('session:session-1:')).map(([, value]) => (value as any).ledger.warms).sort();
  expect(actors).toEqual([1, 2]);
  const c = new Harness(); c.values = shared; c.now = b.now + 1000; await c.start();
  expect((await c.command('status')).text).toContain('session 2 warms');
});
test('snapshots past the restore horizon are pruned at start; fresh ones stay', async () => {
  const h = new Harness(); const fresh = { version: 1, sessionId: 'other', savedAt: h.now - 1000, anchor: null, ledger: { spent: 0, warms: 0, episodes: 0, estimatedNet: 0, unknown: 0 } };
  h.values.set('session:old:x', { ...fresh, sessionId: 'old', savedAt: h.now - 8 * 86_400_000 }); h.values.set('session:other:y', fresh);
  await h.start();
  expect(h.values.has('session:old:x')).toBe(false); expect(h.values.has('session:other:y')).toBe(true);
});
