import { test, expect, mock } from 'claude-code/testing';
test('native timer fork and immediate command use the registered plugin', async ($, on) => {
  const clock = mock.clock(on, { now: 1792247410124 }); mock.env(on, {}); mock.store(on);
  let forks = 0, status: string | undefined;
  on('session.id', () => ({ value: 'native-session' }));
  on('command.register', () => ({ value: { command: 'keepwarm' } }));
  on('ui.status', (_$, e) => { status = e.text; return { value: undefined }; });
  on('ui.toast', () => ({ value: undefined }));
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }));
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('classic.Stop', () => ({}));
  on('agent.list', () => ({ value: [] }));
  on('turn.step', async function* (_$, e) { return { turnId: e.turnId, index: e.index, answer: 'WAITING', toolUses: [], stopReason: 'end_turn', usage: { model: 'claude-haiku-5-5', input_tokens: 2, output_tokens: 807, cache_read_input_tokens: 48952, cache_creation_input_tokens: 793 } }; });
  on('model.fork', (_$, e) => { expect(e.prompt).toBe('Cache keep-warm only. Reply exactly K. No tools.'); forks++; return { value: { isAnswered: true, text: 'K', usage: { input_tokens: 25, output_tokens: 3, cache_read_input_tokens: 49745, cache_creation_input_tokens: 807 } } }; });
  let loadError: string | undefined;
  try { await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true }); } catch (error) { loadError = String(error); }
  expect(loadError).toBeUndefined();
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 2 })) { /* pass-through */ }
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'native-task', type: 'shell', status: 'running', description: 'native clock task', command: 'wait' }] });
  expect(status).toContain('waiting on command'); await clock.advance(240000); await clock.settle(); expect(forks).toBe(1);
  const off = await $.command.run({ command: 'keepwarm', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }); expect(off.text).toContain('off (session override)');
  await clock.advance(600000); expect(forks).toBe(1);
});
