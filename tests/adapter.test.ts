import { expect, test } from 'vitest';
import { Harness } from './stand-in.ts';
test('loads native controls, arms once, warms invisibly and accounts actual spend', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  expect(h.loadError).toBeUndefined(); expect(h.pending).toHaveLength(1);
  expect(h.pending[0]?.at).toBe(1792247650124); expect(h.status).toContain('waiting on agent');
  await h.advance(240000);
  expect(h.lists).toBe(1); expect(h.forks).toEqual([{ prompt: 'Cache keep-warm only. Reply exactly K. No tools.' }]);
  expect(h.pending).toHaveLength(1); expect(h.pending[0]?.at).toBe(1792247890124);
  expect(h.status).toContain('warms 1'); expect(h.rows().some((r: any) => r.spent === 6628.5)).toBe(true);
  expect(JSON.stringify(h.rows())).not.toContain('sk-test-123');
  expect(h.commands).toMatchObject([{ name: 'keepwarm', immediate: true, argumentHint: '[on|off|status]' }]);
});
test.each([[49745, 2880000, 'fork'], [30000, 240000, 'rewrite']] as const)('a 1h warm reading %s re-arms on the TTL its entry now has', async (read, next, last) => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }); await h.arm();
  h.forkResult = { isAnswered: true, text: 'K', usage: { input_tokens: 25, output_tokens: 3, cache_read_input_tokens: read, cache_creation_input_tokens: 49747 - read } };
  const fire = h.pending[0]!.at; await h.advance(2880000); expect(h.forks).toHaveLength(1);
  expect(h.pending[0]?.at).toBe(fire + next);
  const rows = h.rows().filter((r: any) => r.event === 'fork' || r.event === 'rewrite');
  expect(rows.at(-1)).toMatchObject({ event: last, ttl: '1h', ...(last === 'rewrite' ? { entryTtl: '5m', anchorAt: fire } : {}) });
});
test.each(['prompt.submit', 'prompt.edit', 'prompt.change', 'session.receive', 'session.compact', 'classic.PostModelSwitch', 'session.end'])('cancel on %s wins', async event => {
  const h = new Harness(); await h.arm(); expect(h.pending).toHaveLength(1); await h.emit(event, { text: 'draft', origin: { kind: 'composer' } });
  expect(h.pending).toHaveLength(0); expect(h.status).toBeUndefined(); await h.advance(400000); expect(h.forks).toHaveLength(0);
});
test('main step cancels but agent step and agent delivery do not', async () => {
  const h = new Harness(); await h.arm(); await h.step(undefined, 'sub'); await h.emit('session.receive', { agentId: 'sub' });
  expect(h.pending).toHaveLength(1); await h.step(); expect(h.pending).toHaveLength(0); expect(h.status).toBeUndefined();
});
test.each(['api-error', 'empty-reply', 'aborted', 'nothing-to-fork', 'throw'])('failure %s never retries', async reason => {
  const h = new Harness(); await h.arm();
  h.forkResult = reason === 'throw' ? new Error('boom') : { isAnswered: false, reason, status: 529, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  await h.advance(240000); expect(h.forks).toHaveLength(1); expect(h.pending).toHaveLength(0);
  expect(h.status).toContain(reason === 'throw' ? 'threw: boom' : reason === 'api-error' ? 'api-error 529' : reason);
  await h.advance(900000); expect(h.forks).toHaveLength(1);
});
test('late fork accounts without reviving off or input status', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  let release!: (r: unknown) => void; h.forkImpl = () => new Promise(resolve => { release = resolve; });
  const firing = h.advance(240000); await h.forkStarted; expect(h.forks).toHaveLength(1);
  await h.command('off'); const status = h.status; release(h.forkResult); await firing;
  expect(h.status).toBe(status); expect(h.pending).toHaveLength(0);
  expect(h.rows().some((r: any) => r.event === 'fork' && r.spent === 6628.5)).toBe(true);
  expect((await h.command('status'))?.text).toContain('spent ≈ 6.6k-eq');
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
    expect(h.forks).toHaveLength(0); expect(h.pending).toHaveLength(0);
    expect(h.status).toContain({ draft: 'typing', ended: 'killed', missing: 'background_tasks' }[kind]);
  }
});
test('log rejection is visible once and does not prevent warming', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); h.writeError = new Error('disk full'); await h.arm(); await h.advance(240000);
  expect(h.forks).toHaveLength(1); expect(h.status).toContain('log write failed'); expect((await h.command('status')).text).toContain('log write failed');
});
test('same session restore shows age, but no grant; zero cache step invalidates', async () => {
  const h = new Harness(); await h.arm(); const entries = new Map(h.values);
  const resumed = new Harness(); resumed.values = entries; resumed.now = h.now + 1000; await resumed.start();
  expect((await resumed.command('status'))?.text).toContain('[resumed]'); expect(resumed.pending).toHaveLength(0);
  await resumed.step({ input_tokens: 50000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'haiku' }); await resumed.stop();
  expect(resumed.pending).toHaveLength(0); expect(resumed.status).toContain('no main request');
});

test('empty programmatic draft changes preserve the grant; repeated Stop retains spend', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  await h.emit('prompt.change', { text: '', cursor: 0, origin: 'plugin' }); expect(h.pending).toHaveLength(1);
  await h.advance(240000); await h.stop();
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
  const h = new Harness(); await h.arm(); await h.advance(240000); await h.command('off');
  await h.emit('session.end', { reason: 'clear' }, { sessionId: 'session-2' });
  expect((await h.command('status'))?.text).toContain('on (launch default)');
  expect((await h.command('status'))?.text).toContain('session 0 warms');
});

// Reachable native-operation interleavings, not elapsed-time sleeps.
test('slow admission preparation cannot send at or beyond the safety deadline', async () => {
  const h = new Harness(); await h.arm();
  h.engine.agent.list = async () => { h.now += 60000; return h.agents as any; };
  await h.advance(240000);
  expect(h.forks).toHaveLength(0); expect(h.status).toContain('cache cold');
});
test('a stale preparing fire cannot release a newer admitted fork guard', async () => {
  const h = new Harness(); await h.arm();
  let releaseList!: (value: any) => void, releaseFork!: (value: any) => void;
  h.engine.agent.list = () => new Promise(resolve => { releaseList = resolve; });
  await h.advance(240000);
  h.engine.agent.list = async () => h.agents as any;
  await h.step(); await h.stop(); h.forkImpl = () => new Promise(resolve => { releaseFork = resolve; });
  await h.advance(240000); expect(h.forks).toHaveLength(1);
  releaseList(h.agents); await h.settle(); await h.stop(); await h.advance(0);
  const admitted = h.forks.length; releaseFork(h.forkResult); await h.settle();
  expect(admitted).toBe(1);
});
test('settling an old fork reconsiders a newer qualifying wait, never its old epoch', async () => {
  const h = new Harness(); await h.arm(); let release!: (value: any) => void;
  h.forkImpl = () => new Promise(resolve => { release = resolve; }); await h.advance(240000);
  await h.step(); await h.stop(); expect(h.pending).toHaveLength(0);
  h.forkImpl = null; release(h.forkResult); await h.settle();
  expect(h.pending).toHaveLength(1); expect(h.pending[0]!.at).toBe(h.now + 240000);
});
test.each(['session.compact', 'classic.PostModelSwitch', 'session.end'])('old main response cannot restore an invalidated prefix after %s', async event => {
  const h = new Harness(); await h.arm(); const fn = h.handlers.get('turn.step')![0]!.fn;
  const result = { usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 50000, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } };
  const stream = fn(h.engine, {}, async function* () { yield 'held'; return result; });
  await stream.next(); await h.emit(event, { reason: 'clear' }, { sessionId: 'new-session' }); await stream.next(); await h.stop();
  expect(h.pending).toHaveLength(0); expect((await h.command('status')).text).toContain('no main request');
});
test('unknown Stop cannot erase a retained lease timestamp', async () => {
  const h = new Harness({ maxWaitMinutes: 6 }); await h.arm();
  h.now += 180000; await h.emit('classic.Stop', {}); h.now += 60000; await h.step(); await h.stop();
  expect(h.pending).toHaveLength(0); expect(h.status).toContain('wait window ends before expiry');
});
test('agent-list failure keeps tracked work and reports refinement failure without failing a fork', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm();
  h.engine.agent.list = async () => { throw new Error('roster unavailable'); }; await h.advance(240000);
  expect(h.forks).toHaveLength(1); expect(h.rows().some((r: any) => r.event === 'agent-list-failed')).toBe(true);
});
test.each(['clear', 'resume'])('continuing %s separates identity, rows and observed TTL', async reason => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.advance(240000);
  h.id = 'session-2'; await h.emit('session.end', { reason }, { sessionId: h.id }); await h.step(); await h.stop();
  expect(h.snapshot('session-2')).toBeDefined();
  expect(h.rows().some((r: any) => r.event === 'fork')).toBe(false); expect(h.status).toContain('waiting on');
});
test('bad launch variables remain observable after normal status painting', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_MAX_WAIT_MINUTES: 'bad' }); await h.arm();
  expect(h.status).toContain('CACHE_KEEPWARM_MAX_WAIT_MINUTES'); expect((await h.command('status')).text).toContain('CACHE_KEEPWARM_MAX_WAIT_MINUTES');
});

test('late fork settlement remains accounted to its departed session only', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); let release!: (value: any) => void;
  h.forkImpl = () => new Promise(resolve => { release = resolve; }); await h.advance(240000);
  h.id = 'session-2'; await h.emit('session.end', { reason: 'clear' }, { sessionId: h.id }); await h.step(); await h.stop();
  release(h.forkResult); await h.settle();
  expect(h.snapshot('session-1')).toMatchObject({ ledger: { warms: 1, spent: 6628.5 } });
  expect((await h.command('status')).text).toContain('session 0 warms');
});

const enoent = (path: string) => { throw new Error(`ENOENT: no such file or directory, stat '${path}'`); };
test('a link or special file at the log target is refused visibly and never written', async () => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' });
  h.statImpl = async path => path.endsWith('.jsonl') ? { kind: 'other', isLink: true, size: 0, mtimeMs: 0 } : enoent(path);
  await h.arm(); await h.advance(240000);
  expect(h.forks).toHaveLength(1); expect(h.writes).toHaveLength(0);
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
  const a = new Harness(); a.values = shared; await a.arm(); await a.advance(240000);
  const b = new Harness(); b.values = shared; b.now = a.now + 1000; await b.start(); await b.step(); await b.stop(); await b.advance(240000);
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
