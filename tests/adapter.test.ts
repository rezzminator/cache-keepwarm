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
test.each([['precompute', 1], ['auto', 0]] as const)('a %s compaction logs its trigger and agentId; %i warm stays pending', async (trigger, pending) => {
  const h = new Harness({}, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.emit('session.compact', { trigger, agentId: 'sub', instructions: 'secret focus', messages: [] }); expect(h.pending).toHaveLength(pending); expect(h.rows().filter((r: any) => r.event === 'compact')).toMatchObject([{ trigger, agentId: 'sub' }]); expect(JSON.stringify(h.rows())).not.toContain('secret focus'); });
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
test('sub-agent warm is addressed, attributable, independent, re-anchored and privately accounted', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait();
  expect(h.pending).toHaveLength(1); h.draft = 'user typing'; await h.emit('prompt.edit'); await h.emit('turn.start', { turnId: 'main', text: 'Continue' }); await h.step();
  await h.advance(240000); expect(h.sends).toEqual([{ to: { agentId: 'sub' }, text: 'Cache keep-warm: your prompt cache was about to expire and was kept alive because you are still waiting on sleep 540 (4m). Nothing has changed. Reply exactly K and end your turn; do not call tools.' }]);
  expect(h.forks).toHaveLength(0); await h.warmReply(); expect(h.pending[0]?.at).toBe(h.now + 240000);
  expect((await h.command('status')).text).toContain('sub-agents 1'); expect((await h.command('status')).text).toContain('sleep 540');
  const rows = h.rows().filter((r: any) => r.kind === 'subagent' && r.event === 'warm'); expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ agentId: 'sub', spent: 6628.5, warms: 1 }); expect(JSON.stringify(rows)).not.toContain('sleep');
  await h.emit('session.receive', { agentId: 'sub', text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' } });
  expect(h.pending).toHaveLength(0); await h.advance(300000); expect(h.sends).toHaveLength(1);
});
test.each(['idle', 'completed', 'failed', 'killed', 'running'])('sub-agent %s is checked immediately before send', async status => {
  const h = new Harness({ subagents: true }); await h.start(); await h.agentWait(); expect(h.pending).toHaveLength(1);
  h.agents.find(a => a.id === 'sub')!.status = status; await h.advance(240000); expect(h.sends).toHaveLength(0); expect(h.pending).toHaveLength(0);
});
test.each(['unowned', 'default', 'option', 'environment', 'off', 'foreign', 'compact', 'end'])('sub-agent cancellation %s never warms', async kind => {
  const h = new Harness(kind === 'option' ? { subagents: false } : kind === 'default' ? {} : { subagents: true }, kind === 'environment' ? { CACHE_KEEPWARM_SUBAGENTS: '0' } : {});
  await h.start(); await h.agentWait('sub', kind !== 'unowned');
  if (kind === 'off') await h.command('off'); if (kind === 'foreign') await h.emit('turn.start', { agentId: 'sub', turnId: 'foreign', text: 'New work' });
  if (kind === 'compact') await h.emit('session.compact'); if (kind === 'end') await h.emit('session.end', { reason: 'exit' });
  await h.advance(300000); expect(h.sends).toHaveLength(0); expect(h.pending).toHaveLength(0);
});
test('sub-agent forecast uses actual warm thinking output and stops before a losing next warm', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait(); await h.advance(240000); expect(h.sends).toHaveLength(1);
  await h.warmReply(10000); expect(h.pending).toHaveLength(0); expect(h.rows().some((r: any) => r.kind === 'subagent' && r.reason === 'budget')).toBe(true);
});
test('concurrent agents own distinct timers and foreign turns cannot revive an old warm', async () => {
  const h = new Harness({ subagents: true }); await h.start(); await h.agentWait('one'); await h.agentWait('two'); expect(h.pending).toHaveLength(2);
  await h.advance(240000); expect(h.sends.map(s => s.to.agentId).sort()).toEqual(['one', 'two']);
  await h.emit('turn.start', { agentId: 'one', turnId: 'foreign', text: 'Changed' }); await h.warmReply(3, 'one'); expect(h.pending).toHaveLength(0);
});
test('late admitted warm after off accounts once without reviving a grant', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait(); await h.advance(240000);
  const text = h.sends[0]!.text; await h.emit('turn.start', { agentId: 'sub', turnId: 'warm-sub', text }); await h.command('off');
  await h.warmReply(); expect(h.rows().filter((r: any) => r.kind === 'subagent' && r.event === 'warm')).toHaveLength(1);
  expect((await h.command('status')).text).toContain('session 1 warms'); expect(h.pending).toHaveLength(0);
  await h.emit('turn.complete', { agentId: 'sub', turnId: 'warm-sub', reason: 'answer', usage: h.forkResult });
  expect((await h.command('status')).text).toContain('session 1 warms');
});
test('foreign turn without a new cached request cannot re-use the previous request grant', async () => {
  const h = new Harness({ subagents: true }); await h.start(); await h.agentWait(); await h.emit('turn.start', { agentId: 'sub', turnId: 'new', text: 'Changed' });
  await h.emit('turn.complete', { agentId: 'sub', turnId: 'new', reason: 'answer' }); expect(h.pending).toHaveLength(0);
});
test.each(['slow', 'list-error', 'send-refused', 'send-error', 'task-ended', 'idle-child'])('sub-agent boundary %s fails closed', async kind => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait();
  if (kind === 'slow') h.engine.agent.list = async () => { h.now += 60000; return h.agents as any; };
  if (kind === 'list-error') h.engine.agent.list = async () => { throw new Error('roster unavailable'); };
  if (kind === 'send-refused') h.sendImpl = async () => ({ isDelivered: false, reason: 'gone' });
  if (kind === 'send-error') h.sendImpl = async () => { throw new Error('send unavailable'); };
  if (kind === 'idle-child') { h.agents.push({ id: 'child', status: 'idle', parentId: 'sub', description: 'Child work' } as any); await h.emit('classic.SubagentStop', { agent_id: 'sub', background_tasks: [] }); }
  if (kind === 'task-ended') await h.emit('classic.SubagentStop', { agent_id: 'sub', background_tasks: [{ id: 'work-sub', type: 'shell', status: 'completed', description: 'Work' }] });
  await h.advance(240000); expect(h.sends).toHaveLength(kind.startsWith('send') ? 1 : 0); expect(h.pending).toHaveLength(0);
});
test('a departed sub-agent warm never writes usage or anchors into the cleared session', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait(); await h.advance(240000);
  const text = h.sends[0]!.text; await h.emit('turn.start', { agentId: 'sub', turnId: 'warm-sub', text });
  h.id = 'new-session'; await h.emit('session.end', { reason: 'clear' }, { sessionId: h.id });
  await h.warmReply(); expect((await h.command('status')).text).toContain('session 0 warms');
  expect(h.writes.filter((_, i) => h.paths[i]!.includes('/new-session.')).join('')).not.toContain('\"kind\":\"subagent\"');
  expect(h.writes.some(text => text.includes('"event":"warm"'))).toBe(true); expect(h.pending).toHaveLength(0);
});
test('native self-send may skip start and step but complete accounts and re-anchors using the receipt', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait(); await h.advance(240000);
  h.messages = [{ role: 'user', text: `The coordinator sent a message while you were working:\n${h.sends[0]!.text}\n\nAddress this before completing your current task.`, toolUses: [] }, { role: 'assistant', text: 'K', toolUses: [] }];
  const usage = { input_tokens: 4, output_tokens: 3, cache_read_input_tokens: 50000, cache_creation_input_tokens: 126, model: 'claude-haiku-5-5' };
  await h.emit('turn.complete', { agentId: 'sub', turnId: 'native-warm', reason: 'answer', answer: 'K', usage });
  expect(h.rows().some((r: any) => r.kind === 'subagent' && r.event === 'warm' && r.spent === 5271)).toBe(true); expect(h.pending[0]?.at).toBe(h.now + 240000);
});
test.each(['K', 'Done'])('native hand-back %s remains an ordinary delivery; no unproven report suppression', async result => {
  const h = new Harness({ subagents: true }); await h.arm(); await h.agentWait(); await h.advance(240000);
  h.messages = [{ role: 'user', text: h.sends[0]!.text, toolUses: [] }, { role: 'assistant', text: 'K', toolUses: [] }];
  const input = { origin: { kind: 'task-notification' }, text: `<task-notification><task-id>sub</task-id><tool-use-id>toolu_plugin_abc</tool-use-id><result>${result}</result></task-notification>` };
  expect((await h.emit('session.receive', input, { text: input.text })).result).toEqual({ text: input.text });
});
test.each(['list-error', 'send-refused', 'send-error'])('late %s stop log cannot cancel a newer request grant', async kind => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait();
  let release!: () => void, reached!: () => void; const blocked = new Promise<void>(r => { reached = r; }), wait = new Promise<void>(r => { release = r; });
  const list = h.engine.agent.list;
  if (kind === 'list-error') h.engine.agent.list = async () => { throw new Error('roster unavailable'); };
  if (kind === 'send-refused') h.sendImpl = async () => ({ isDelivered: false, reason: 'gone' });
  if (kind === 'send-error') h.sendImpl = async () => { throw new Error('send unavailable'); };
  h.writeImpl = async () => { if (h.writes.at(-1)?.includes('"event":"stop"')) return; reached(); await wait; };
  await h.advance(240000); await blocked; h.engine.agent.list = list;
  await h.emit('turn.start', { agentId: 'sub', turnId: 'new', text: 'Changed' });
  const step = h.step(undefined, 'sub', 'new'); await h.settle(); release(); await step;
  await h.emit('turn.complete', { agentId: 'sub', turnId: 'new', reason: 'answer' });
  expect(h.pending).toHaveLength(1);
});
test.each(['main-first', 'sub-first'])('departed main and sub charges share one ledger: %s', async order => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.arm(); await h.agentWait();
  let release!: (r: unknown) => void; h.forkImpl = () => new Promise(resolve => { release = resolve; });
  await h.advance(240000); await h.forkStarted;
  await h.emit('turn.start', { agentId: 'sub', turnId: 'warm-sub', text: h.sends[0]!.text });
  h.id = 'new-session'; await h.emit('session.end', { reason: 'clear' }, { sessionId: h.id });
  const main = async () => { release(h.forkResult); await h.settle(); };
  if (order === 'main-first') { await main(); await h.warmReply(); } else { await h.warmReply(); await main(); }
  await h.settle(); expect(h.snapshot('session-1').ledger).toMatchObject({ warms: 2, spent: 13257 });
  const text = h.writes.filter((_, i) => h.paths[i]!.includes('/session-1.')).at(-1)!;
  expect(text).toContain('"event":"fork"'); expect(text).toContain('"event":"warm"');
});
test('late unknown-usage completion log cannot cancel a newer grant', async () => {
  const h = new Harness({ subagents: true }, { CACHE_KEEPWARM_LOG_DIR: 'logs' }); await h.start(); await h.agentWait(); await h.advance(240000);
  await h.emit('turn.start', { agentId: 'sub', turnId: 'warm-sub', text: h.sends[0]!.text });
  let release!: () => void, reached!: () => void; const blocked = new Promise<void>(r => { reached = r; }), wait = new Promise<void>(r => { release = r; });
  h.writeImpl = async () => { reached(); await wait; };
  const complete = h.emit('turn.complete', { agentId: 'sub', turnId: 'warm-sub', reason: 'answer' }); await blocked;
  await h.emit('turn.start', { agentId: 'sub', turnId: 'new', text: 'Changed' });
  const step = h.step(undefined, 'sub', 'new'); await h.settle(); release(); await step;
  await h.emit('turn.complete', { agentId: 'sub', turnId: 'new', reason: 'answer' }); await complete;
  expect(h.pending).toHaveLength(1);
});
