import { test, expect, mock } from 'claude-code/testing';
test('native timer poke and immediate command use the registered plugin', async ($, on) => {
  const clock = mock.clock(on, { now: 1792247410124 }); mock.env(on, {}); mock.store(on);
  const submits: string[] = []; let status: string | undefined;
  on('session.id', () => ({ value: 'native-session' }));
  on('command.register', () => ({ value: { command: 'keepwarm' } }));
  on('ui.status', (_$, e) => { status = e.text; return { value: undefined }; });
  on('ui.toast', () => ({ value: undefined }));
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('classic.Stop', () => ({}));
  on('agent.list', () => ({ value: [] }));
  on('turn.step', async function* (_$, e) { return { turnId: e.turnId, index: e.index, answer: 'WAITING', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-haiku-5-5', input_tokens: 2, output_tokens: 807, cache_read_input_tokens: 48952, cache_creation_input_tokens: 793 } }; });
  on('prompt.submit', (_$, e) => { submits.push(e.text); return { text: e.text }; });
  let loadError: string | undefined;
  try { await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true }); } catch (error) { loadError = String(error); }
  expect(loadError).toBeUndefined();
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 2 })) { /* pass-through */ }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'native-task', type: 'shell', status: 'running', description: 'native clock task', command: 'wait' }] });
  expect(status).toContain('waiting on command'); await clock.advance(240000); await clock.settle();
  expect(submits).toEqual(['Keep-warm poke 1/4: your prompt cache was about to expire, so this message keeps it warm while you wait on:\n- command `native-task`: wait, pending 4m\nIf any of these is stale or was started by accident, stop it now. Otherwise reply `waiting` and end your turn.']);
  const off = await $.command.run({ command: 'keepwarm', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }); expect(off.text).toContain('off (session override)');
  await clock.advance(600000); expect(submits).toHaveLength(1);
});
