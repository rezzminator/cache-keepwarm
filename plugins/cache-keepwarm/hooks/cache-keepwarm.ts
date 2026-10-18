import type { EngineInterface, Register, Timer, ModelForkResult } from 'claude-code';
import { resolveOptions, type Options } from '../src/options.ts';
import { resolveTtl, observeTtl, entryAfterWarm, type Ttl, type TtlResolution, type TtlEnv } from '../src/ttl.ts';
import { fromStop, reconcile, ownedFromTool, warmReceipt, sanitizeLabel, firstSeen, leaseExpired, type WaitItem, type EndedItem } from '../src/waits.ts';
import { TTL_MS, WARM_1H, nextFireAt } from '../src/schedule.ts';
import { budgetLedger, closeLedger, emptySessionLedger, recordWarm, recordOutcome, warmSpend, warmForecast, type Usage, type SessionLedger, type ClosedLedger } from '../src/budget.ts';
import { decideWarm, type Decision, type ReasonCode } from '../src/decision.ts';
import { parseControl, effectiveEnabled } from '../src/control.ts';
import { pickRestore, snapshotSession, sessionKey, sessionPrefix, staleKeys, type Anchor } from '../src/resume.ts';
import { appendLog, logFileName, logBase, leafRefusal, type LogRow, type LogStat } from '../src/log.ts';
import { compactFacts, compactResets } from '../src/compact.ts';
import { subagentMessage, formatWaiting, formatStopped, formatState, formatBand, formatOutcome, type StatusView } from '../src/status.ts';
type Episode = { pending: boolean; items: WaitItem[]; known: boolean; started: number; originalExpiry: number; context: number; model: string; spent: number; warms: number; epoch: number };
type WarmCharge = { a: SubState; epoch: number; at: number; text: string; turnId?: string; episode: NonNullable<SubState['episode']>; sessionId: string; owner?: State };
type State = { charges: Map<string, WarmCharge>; subagents: Map<string, SubState>; options: Options; config: Record<string, unknown>; ttlEnv: TtlEnv; ttl: TtlResolution; observed: Ttl | null; anchor: Anchor | null; override: boolean | null; busy: boolean; typing: boolean; epoch: number; inFlight: boolean; timer?: Timer; tick?: Timer; episode: Episode | null; closing: Episode | null; seen: Map<string, number>; reason: ReasonCode; now: number; nextAt: number; id: string; session: SessionLedger; lastOutcome: ClosedLedger | null; rows: LogRow[]; writes: Promise<void>; stores: Promise<void>; instance: string; logPinned: string | null; logFailed: boolean; logError?: string; inactive?: boolean; departing?: State; ended?: EndedItem; detail?: string };
async function readOptionEnv($: EngineInterface) {
  return { CACHE_KEEPWARM_SUBAGENTS: await $.env.get('CACHE_KEEPWARM_SUBAGENTS'), CACHE_KEEPWARM_ENABLED: await $.env.get('CACHE_KEEPWARM_ENABLED'), CACHE_KEEPWARM_MIN_CONTEXT: await $.env.get('CACHE_KEEPWARM_MIN_CONTEXT'), CACHE_KEEPWARM_MAX_WAIT_MINUTES: await $.env.get('CACHE_KEEPWARM_MAX_WAIT_MINUTES'), CACHE_KEEPWARM_LOG_DIR: await $.env.get('CACHE_KEEPWARM_LOG_DIR'), CACHE_KEEPWARM_BAND: await $.env.get('CACHE_KEEPWARM_BAND') };
}
async function readTtlEnv($: EngineInterface): Promise<TtlEnv> { return { FORCE_PROMPT_CACHING_5M: await $.env.get('FORCE_PROMPT_CACHING_5M'), CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'), CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL'), ENABLE_PROMPT_CACHING_1H: await $.env.get('ENABLE_PROMPT_CACHING_1H') }; }
function enabled(s: State) { return effectiveEnabled(s.options.enabled, s.override); }
function view(s: State): StatusView {
  const e = s.episode;
  return { enabled: enabled(s), source: s.override === null ? 'launch' : 'session', reason: s.reason, items: (e?.items ?? []).map(i => ({ ...i, firstSeenAt: s.seen.get(i.id) ?? s.now })), now: s.now, warms: e?.warms ?? 0, nextInMs: s.nextAt - s.now, ttl: s.ttl.ttl, ttlSource: s.ttl.source, context: s.anchor?.context ?? null, ledger: e ? budgetLedger({ context: e.context, ttl: s.ttl.ttl, spent: e.spent, warms: e.warms }) : null, session: s.session, lastOutcome: s.lastOutcome, warnings: [...(s.options.bad.length ? ['bad options: ' + s.options.bad.join(', ')] : []), ...(s.logError ? [s.logError] : [])] };
}
function paint($: EngineInterface, s: State) {
  const v = view(s), e = s.episode;
  let text: string | undefined;
  if (enabled(s) && !s.busy) {
    if (s.reason === 'eligible' && e) text = formatWaiting({ ...v, reasonCode: s.reason });
    else if (s.reason === 'small') text = formatStopped({ reason: 'small', context: s.anchor?.context, minContext: s.options.minContext, reasonCode: s.reason });
    else if (s.reason === 'lease') text = formatStopped({ reason: 'lease', item: e?.items.find(i => i.id === s.detail) ?? e?.items[0], minutes: s.options.maxWaitMinutes, reasonCode: s.reason });
    else if (s.reason === 'budget') text = formatStopped({ reason: 'budget', warms: e?.warms ?? 0, reasonCode: s.reason });
    else if (s.reason === 'ended' && s.ended) text = formatStopped({ reason: 'ended', item: s.ended.item, detail: s.ended.ended, reasonCode: s.reason });
    else if (s.reason === 'fork-failed' || s.reason === 'timer-failed') text = formatStopped({ reason: s.reason === 'fork-failed' ? 'error' : 'timer', detail: s.detail, reasonCode: s.reason });
    else if (s.reason !== 'idle' && s.reason !== 'nothing-pending') text = formatStopped({ reason: 'decision', detail: s.reason, reasonCode: s.reason });
  }
  if (v.warnings?.length) text = [text, ...v.warnings].filter(Boolean).join(' · ');
  $.ui.status(text); $.ui.invalidate('ui.render');
}
function cancel($: EngineInterface, s: State, reason: ReasonCode, closing = false) {
  ++s.epoch; s.timer?.cancel(); s.tick?.cancel(); s.timer = undefined; s.tick = undefined; s.nextAt = 0;
  if (closing && s.episode?.warms) s.closing ??= s.episode;
  s.episode = null; s.reason = reason; $.ui.status(undefined); $.ui.invalidate('ui.render');
}
async function persist($: EngineInterface, s: State) {
  if (!s.id) return;
  const key = sessionKey(s.id, s.instance), data = snapshotSession({ sessionId: s.id, savedAt: s.now, anchor: s.anchor, ledger: s.session });
  s.stores = s.stores.then(() => $.store.set(key, data)).catch(error => { $.ui.toast(`cache-keepwarm · store write failed (${String(error)})`); });
  await s.stores;
}
async function log($: EngineInterface, s: State, event: string, reason = s.reason, usage?: Usage, episode = s.episode, row?: LogRow, extra?: Partial<LogRow>) {
  s.rows = appendLog(s.rows, { ...(row ?? { at: s.now, ...(s.anchor ? { anchorAt: s.anchor.at, ...(s.anchor.entryTtl ? { entryTtl: s.anchor.entryTtl } : {}) } : {}), event, epoch: episode?.epoch ?? s.epoch, items: episode?.items ?? [], ttl: s.ttl.ttl, ttlSource: s.ttl.source, context: episode?.context ?? s.anchor?.context ?? null, spent: episode?.spent ?? 0, reason, ...(usage ? { usage } : {}), ...(episode ? { ledger: budgetLedger({ context: episode.context, ttl: s.ttl.ttl, spent: episode.spent, warms: episode.warms }), warms: episode.warms } : {}), session: s.session }), ...extra });
  if (!s.options.logDir || !s.id) return;
  const logId = s.id, dir = s.options.logDir.replace(/\/$/, ''), name = logFileName(s.id, s.instance), text = s.rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  s.writes = s.writes.then(() => writeLog($, s, logId, dir, name, text)).catch(error => { logFault($, s, logId, `log write failed (${String(error)})`); });
  await s.writes;
}
function logFault($: EngineInterface, s: State, logId: string, message: string) {
  if (s.id !== logId || s.logFailed) return;
  s.logFailed = true; s.logError = message; $.ui.toast(`cache-keepwarm · ${message}`); if (!s.inactive) paint($, s);
}
async function statOrNull($: EngineInterface, path: string, resolve: boolean): Promise<LogStat | null> {
  try { return await $.fs.stat(path, { resolve }); }
  catch (error) { if (/ENOENT/.test(String(error))) return null; throw error; }
}
async function writeLog($: EngineInterface, s: State, logId: string, dir: string, name: string, text: string) {
  const base = logBase({ dir, stat: await statOrNull($, dir, true), pinned: s.logPinned });
  if (!base.ok) { logFault($, s, logId, `log write refused (${base.reason})`); return; }
  const path = `${base.base}/${name}`, refusal = leafRefusal(await statOrNull($, path, false));
  if (refusal) { logFault($, s, logId, `log write refused (${refusal})`); return; }
  s.logPinned = base.pinned; await $.fs.write(path, text);
}
async function restore($: EngineInterface, s: State, prune: boolean) {
  try {
    const entries: { key: string; value: unknown }[] = [];
    for (const key of await $.store.keys()) if (key.startsWith('session:')) entries.push({ key, value: await $.store.get(key) });
    const stale = new Set(staleKeys(entries, { now: s.now }));
    if (prune) for (const key of stale) await $.store.delete(key);
    const prefix = sessionPrefix(s.id), restored = pickRestore(entries.filter(e => e.key.startsWith(prefix) && !stale.has(e.key)).map(e => e.value), { sessionId: s.id, now: s.now });
    if (restored.kind === 'restored') { s.anchor = restored.anchor; s.session = restored.ledger; s.reason = 'resumed'; }
    else if (restored.kind === 'rejected') $.ui.toast(`cache-keepwarm · resume refused (${restored.reason})`);
  } catch (error) { $.ui.toast(`cache-keepwarm · restore failed (${String(error)})`); }
}
function queueLog($: EngineInterface, s: State, event: string) { void log($, s, event).catch(error => { $.ui.toast(`cache-keepwarm · logging failed (${String(error)})`); }); }
function decision(s: State, epoch: number, fault?: 'fork-failed' | 'timer-failed'): Decision {
  const e = s.episode, ledger = e ? budgetLedger({ context: e.context, ttl: s.ttl.ttl, spent: e.spent, warms: e.warms }) : null;
  return decideWarm({ fault, enabled: enabled(s), busy: s.busy, typing: s.typing, currentEpoch: s.epoch === epoch, inFlight: s.inFlight, known: e?.known ?? false, context: s.anchor?.context ?? null, minContext: s.options.minContext, lastSendAt: s.anchor?.at ?? null, now: s.now, ttl: s.anchor?.entryTtl ?? s.ttl.ttl, warm1h: WARM_1H, items: (e?.items ?? []).map(i => ({ id: i.id, expired: leaseExpired({ firstSeenAt: s.seen.get(i.id) ?? s.now, now: s.now, maxWaitMinutes: s.options.maxWaitMinutes }), leaseEndsAt: (s.seen.get(i.id) ?? s.now) + s.options.maxWaitMinutes * 60000, expectedBackAt: null, wake: ['agent', 'command', 'monitor', 'workflow'].includes(i.kind) ? 'yes' : 'unknown' })), ...(s.ended ? { endedId: s.ended.item.id } : {}), spent: e?.spent ?? 0, forecast: warmForecast({ context: s.anchor?.context ?? 0, tail: e?.warms ? 0 : s.anchor?.tail ?? 0 }), saved: ledger?.allowance ?? 0 });
}
function refuse($: EngineInterface, s: State, d: Decision) { s.timer?.cancel(); s.tick?.cancel(); s.timer = undefined; s.tick = undefined; s.reason = d.reason; s.detail = d.itemId; paint($, s); }
async function arm($: EngineInterface, s: State, epoch: number) {
  const now = await $.clock.now(); if (s.epoch !== epoch) return; s.now = now;
  const d = decision(s, epoch); s.reason = d.reason;
  queueLog($, s, 'decision');
  if (d.action !== 'warm' || !s.anchor) { refuse($, s, d); return; }
  s.nextAt = nextFireAt({ lastSendAt: s.anchor.at, ttl: s.anchor.entryTtl ?? s.ttl.ttl });
  try {
    s.timer = $.clock.after(Math.max(0, s.nextAt - s.now), () => { void fire($, s, epoch); });
    if (!s.tick) s.tick = $.clock.every(60000, () => { void refresh($, s, epoch); });
    paint($, s);
  } catch (error) { s.reason = decision(s, epoch, 'timer-failed').reason; s.detail = String(error); s.timer?.cancel(); s.tick?.cancel(); s.timer = undefined; s.tick = undefined; paint($, s); await log($, s, 'stop'); }
}
async function refresh($: EngineInterface, s: State, epoch: number) {
  try { const now = await $.clock.now(); if (s.epoch !== epoch) return; s.now = now; paint($, s); }
  catch (error) { if (s.epoch === epoch) { s.reason = decision(s, epoch, 'timer-failed').reason; s.detail = String(error); s.timer?.cancel(); s.tick?.cancel(); paint($, s); await log($, s, 'stop'); } }
}
async function fire($: EngineInterface, s: State, epoch: number) {
  const e = s.episode, id = s.id;
  if (!e || s.epoch !== epoch) return;
  s.timer = undefined;
  let admitted = false;
  try {
    s.now = await $.clock.now(); if (s.epoch !== epoch) return;
    const draft = await $.prompt.read(); if (s.epoch !== epoch) return; s.typing = draft.text.length > 0;
    try { const agents = await $.agent.list(); if (s.epoch !== epoch) return; const refined = reconcile(e.items, agents); e.items = refined.items; s.ended = refined.ended[0]; }
    catch (error) { if (s.epoch !== epoch) return; $.ui.toast(`cache-keepwarm · agent-list-failed (${String(error)})`); queueLog($, s, 'agent-list-failed'); }
    const now = await $.clock.now(); if (s.epoch !== epoch) return; s.now = now;
    const d = decision(s, epoch); s.reason = d.reason; queueLog($, s, 'decision');
    if (d.action !== 'warm') { refuse($, s, d); return; }
    s.inFlight = true; e.pending = true; admitted = true;
    const sentAt = s.now; queueLog($, s, 'admit');
    let result: ModelForkResult;
    try { result = await $.model.fork({ prompt: 'Cache keep-warm only. Reply exactly K. No tools.' }); }
    catch (error) { if (s.epoch === epoch) { s.reason = decision(s, epoch, 'fork-failed').reason; s.detail = `threw: ${String(error).replace(/^Error: /, '')}`; s.tick?.cancel(); paint($, s); await log($, s, 'stop'); } return; }
    const owner = s.id === id ? s : s.departing?.id === id ? s.departing : null;
    if ('usage' in result) { e.spent += warmSpend(result.usage); e.warms++; if (owner) owner.session = recordWarm(owner.session, result.usage); }
    if (s.id !== id) { if (owner) { await log($, owner, 'fork', result.isAnswered ? 'eligible' : 'fork-failed', 'usage' in result ? result.usage : undefined, e); await persist($, owner); } return; }
    await log($, s, 'fork', result.isAnswered ? 'eligible' : 'fork-failed', 'usage' in result ? result.usage : undefined, e);
    if (s.epoch !== epoch || s.id !== id) { await persist($, s); return; }
    if (!result.isAnswered) { s.reason = decision(s, epoch, 'fork-failed').reason; s.detail = result.reason + (result.reason === 'api-error' ? ` ${result.status}` : ''); s.tick?.cancel(); paint($, s); await persist($, s); return; }
    if (result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens <= 0) { s.anchor = null; s.reason = 'usage-unknown'; s.tick?.cancel(); paint($, s); await persist($, s); return; }
    const entry = entryAfterWarm({ read: result.usage.cache_read_input_tokens, context: s.anchor!.context, env: s.ttlEnv });
    s.anchor = { ...s.anchor!, at: sentAt, tail: result.usage.output_tokens, ...(entry.rewritten ? { entryTtl: entry.ttl.ttl } : {}) };
    if (entry.rewritten) queueLog($, s, 'rewrite');
    s.now = await $.clock.now(); await persist($, s);
  } catch (error) { if (s.epoch === epoch) { s.reason = decision(s, epoch, 'fork-failed').reason; s.detail = `admission failed: ${String(error)}`; s.tick?.cancel(); paint($, s); await log($, s, 'stop'); } }
  finally {
    if (admitted) {
      e.pending = false; s.inFlight = false; s.departing = undefined;
      if (s.epoch !== epoch && s.episode && s.reason === 'in-flight') await arm($, s, s.epoch);
    }
  }
  if (s.epoch === epoch && s.reason === 'eligible') await arm($, s, epoch);
}
function subStatus(s: State): string { const agents = [...s.subagents.values()].filter(a => a.episode); return ` · sub-agents ${agents.length}` + agents.map(a => ` · ${sanitizeLabel(a.owned.values().next().value?.label ?? 'your background work')}: ${a.episode!.warms} warms, spent ≈ ${Math.round(a.episode!.spent / 100) / 10}k-eq`).join(''); }
type SubState = { id: string; epoch: number; anchor: Anchor | null; observed: Ttl | null; ttl: TtlResolution; owned: Map<string, WaitItem>; episode: { started: number; context: number; spent: number; warms: number; output: number } | null; timer?: Timer; guard?: Timer; pending?: { text: string; turnId?: string }; requestTurn?: string };
function subState(s: State, id: string): SubState {
  let a = s.subagents.get(id);
  if (!a) { a = { id, epoch: 0, anchor: null, observed: null, ttl: resolveTtl(s.ttlEnv, null, 'subagent'), owned: new Map(), episode: null }; s.subagents.set(id, a); }
  return a;
}
function endSub(s: State, a: SubState, forget = false) { ++a.epoch; a.timer?.cancel(); a.guard?.cancel(); a.timer = undefined; a.guard = undefined; a.pending = undefined; a.episode = null; a.requestTurn = undefined; if (forget) { a.owned.clear(); a.anchor = null; } }
function departSubs(s: State) { const owner = s.inFlight ? (s.departing ??= { ...s, inactive: true }) : { ...s, inactive: true }; for (const c of s.charges.values()) if (c.sessionId === s.id && !c.owner) c.owner = owner; }
function endSubs(s: State) { for (const a of s.subagents.values()) endSub(s, a, true); s.subagents.clear(); }
async function logSub($: EngineInterface, s: State, a: SubState, event: string, reason: ReasonCode, usage?: Usage, e = a.episode) {
  await log($, s, event, reason, usage, null, { kind: 'subagent', agentId: a.id, at: s.now, event, reason, epoch: a.epoch, items: [...a.owned.values()], ttl: a.ttl.ttl, ttlSource: a.ttl.source, context: e?.context ?? a.anchor?.context ?? null, ...(a.anchor ? { anchorAt: a.anchor.at } : {}), spent: e?.spent ?? 0, warms: e?.warms ?? 0, ...(usage ? { usage } : {}), ...(e ? { ledger: budgetLedger({ context: e.context, ttl: a.ttl.ttl, spent: e.spent, warms: e.warms }) } : {}) });
}
function subDecision(s: State, a: SubState, epoch: number, status: string): Decision {
  const e = a.episode, anchor = a.anchor;
  return decideWarm({ agentStatus: status, enabled: enabled(s) && s.options.subagents, busy: false, typing: false, currentEpoch: a.epoch === epoch, inFlight: s.charges.has(a.id), known: true, context: anchor?.context ?? null, minContext: s.options.minContext, lastSendAt: anchor?.at ?? null, now: s.now, ttl: a.ttl.ttl, warm1h: WARM_1H, items: [...a.owned.values()].map(i => ({ id: i.id, expired: false, leaseEndsAt: (e?.started ?? s.now) + s.options.maxWaitMinutes * 60000, expectedBackAt: null, wake: 'yes' })), spent: e?.spent ?? 0, forecast: warmForecast({ context: anchor?.context ?? 0, tail: e?.warms ? 0 : anchor?.tail ?? 0, output: e?.output }), saved: e ? budgetLedger({ context: e.context, ttl: a.ttl.ttl, spent: e.spent, warms: e.warms }).allowance : 0 });
}
async function subRoster($: EngineInterface, s: State, a: SubState, epoch: number) {
  const agents = await $.agent.list();
  if (a.epoch !== epoch || s.subagents.get(a.id) !== a) return 'unknown';
  for (const child of agents) if (child.parentId === a.id && !['completed', 'failed', 'killed'].includes(child.status)) a.owned.set(child.id, { id: child.id, kind: 'agent', label: sanitizeLabel(child.description) });
  const refined = reconcile([...a.owned.values()], agents, true); a.owned = new Map(refined.items.map(i => [i.id, i]));
  return agents.find(agent => agent.id === a.id)?.status ?? 'unknown';
}
async function armSub($: EngineInterface, s: State, a: SubState) {
  if (!a.episode || a.pending || a.timer) return;
  const epoch = a.epoch;
  try {
    const status = await subRoster($, s, a, epoch); s.now = await $.clock.now(); if (a.epoch !== epoch) return;
    const d = subDecision(s, a, epoch, status); await logSub($, s, a, 'decision', d.reason); if (a.epoch !== epoch) return;
    if (d.action !== 'warm' || !a.anchor) { endSub(s, a); return; }
    a.timer = $.clock.after(Math.max(0, nextFireAt({ lastSendAt: a.anchor.at, ttl: a.ttl.ttl }) - s.now), () => { void fireSub($, s, a, epoch); });
    $.ui.invalidate('ui.render');
  } catch (error) { $.ui.toast(`cache-keepwarm · sub-agent admission failed (${String(error)})`); if (a.epoch === epoch) { await logSub($, s, a, 'stop', 'inventory-unknown'); if (a.epoch === epoch) endSub(s, a); } }
}
async function fireSub($: EngineInterface, s: State, a: SubState, epoch: number) {
  if (a.epoch !== epoch || !a.episode) return; a.timer = undefined;
  try {
    // The roster is checked again at the send boundary, not reused from arming.
    const status = await subRoster($, s, a, epoch); s.now = await $.clock.now(); if (a.epoch !== epoch) return;
    const d = subDecision(s, a, epoch, status);
    if (d.action !== 'warm') { await logSub($, s, a, 'stop', d.reason); if (a.epoch === epoch) endSub(s, a); return; }
    const text = subagentMessage(sanitizeLabel(a.owned.values().next().value?.label ?? ''), s.now - a.episode!.started);
    a.pending = { text }; s.charges.set(a.id, { a, epoch, at: s.now, text, episode: a.episode!, sessionId: s.id });
    a.guard = $.clock.every(60000, () => { if (a.epoch === epoch && a.pending) { $.ui.toast('cache-keepwarm · sub-agent warm did not settle; episode stopped'); endSub(s, a); } });
    void logSub($, s, a, 'admit', d.reason).catch(error => { $.ui.toast(`cache-keepwarm · sub-agent log failed (${String(error)})`); });
    const sent = await $.session.send({ to: { agentId: a.id }, text });
    if (!sent.isDelivered && a.epoch === epoch) { s.charges.delete(a.id); $.ui.toast(`cache-keepwarm · sub-agent send refused (${sent.reason})`); await logSub($, s, a, 'stop', 'fork-failed'); if (a.epoch === epoch) endSub(s, a); }
  } catch (error) { if (s.charges.get(a.id)?.epoch === epoch && !s.charges.get(a.id)?.turnId) s.charges.delete(a.id); $.ui.toast(`cache-keepwarm · sub-agent send failed (${String(error)})`); if (a.epoch === epoch) { await logSub($, s, a, 'stop', 'fork-failed'); if (a.epoch === epoch) endSub(s, a); } }
}
async function completeSub($: EngineInterface, s: State, a: SubState, turnId: string, usage: Usage | undefined, ok: boolean) {
  const charge = s.charges.get(a.id);
  if (charge?.turnId === turnId) {
    s.charges.delete(a.id);
    const e = charge.episode, active = a.epoch === charge.epoch && s.subagents.get(a.id) === a && !!a.pending;
    const owner = charge.owner ?? s; owner.now = s.now;
    if (active) { a.guard?.cancel(); a.guard = undefined; a.pending = undefined; }
    if (!usage || ![usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens].every(n => Number.isFinite(n) && n >= 0)) {
      await logSub($, owner, a, 'stop', 'usage-unknown', undefined, e); if (active && a.epoch === charge.epoch) endSub(s, a); return;
    }
    e.spent += warmSpend(usage); e.warms++; e.output = usage.output_tokens; owner.session = recordWarm(owner.session, usage);
    await logSub($, owner, a, 'warm', ok ? 'eligible' : 'fork-failed', usage, e); await persist($, owner);
    if (!active || a.epoch !== charge.epoch) return;
    if (!ok || !a.anchor || usage.cache_read_input_tokens < e.context * 0.9) { await logSub($, s, a, 'stop', 'cache-cold'); if (a.epoch === charge.epoch) endSub(s, a); return; }
  } else if (!a.episode && a.anchor && a.requestTurn === turnId && a.owned.size && enabled(s) && s.options.subagents) {
    a.episode = { started: s.now, context: a.anchor.context, spent: 0, warms: 0, output: 256 };
  } else return;
  await armSub($, s, a);
}

async function toggle($: EngineInterface, s: State, on: boolean) { endSubs(s); cancel($, s, on ? 'idle' : 'off'); s.override = on; s.typing = false; await log($, s, on ? 'on' : 'cancel'); paint($, s); }
export const register: Register = (on, options) => {
  const s: State = { charges: new Map(), subagents: new Map(), options: resolveOptions(options, {}), config: options, ttlEnv: {}, ttl: { ttl: '5m', source: 'assumed' }, observed: null, anchor: null, override: null, busy: false, typing: false, epoch: 0, inFlight: false, episode: null, closing: null, seen: new Map(), reason: 'idle', now: 0, nextAt: 0, id: '', session: emptySessionLedger(), lastOutcome: null, rows: [], writes: Promise.resolve(), stores: Promise.resolve(), instance: crypto.randomUUID(), logPinned: null, logFailed: false };
  on('session.start', async ($, e, next) => {
    if (s.inFlight) s.departing ??= { ...s, inactive: true };
    departSubs(s); endSubs(s); cancel($, s, 'idle'); s.override = null; s.anchor = null; s.observed = null; s.busy = false; s.typing = false; s.closing = null; s.seen.clear(); s.session = emptySessionLedger(); s.lastOutcome = null; s.rows = []; s.logFailed = false; s.logError = undefined;
    s.options = resolveOptions(options, await readOptionEnv($)); s.ttlEnv = await readTtlEnv($); s.ttl = resolveTtl(s.ttlEnv, null); s.id = await $.session.id(); s.now = await $.clock.now();
    $.command.register({ name: 'keepwarm', description: 'Control warming — /keepwarm [on|off|status] for this chat only; no argument shows state and spend.', argumentHint: '[on|off|status]', immediate: true });
    await restore($, s, true);
    if (s.options.bad.length) $.ui.toast(`cache-keepwarm · bad options: ${s.options.bad.join(', ')}`);
    await log($, s, 'LOADED'); paint($, s); return next(e);
  });
  on('prompt.submit', async ($, e, next) => { cancel($, s, 'busy', true); s.busy = true; s.typing = false; queueLog($, s, 'cancel'); return next(e); });
  on('prompt.edit', async ($, e, next) => { cancel($, s, 'typing'); s.typing = true; queueLog($, s, 'cancel'); return next(e); });
  on('prompt.change', async ($, e, next) => { if (e.text.length > 0) { cancel($, s, 'typing'); s.typing = true; queueLog($, s, 'cancel'); } return next(e); });
  on('session.receive', async ($, e, next) => { if (e.agentId) { const a = s.subagents.get(e.agentId); if (a && !warmReceipt([{ role: 'user', text: e.text, toolUses: [] }], s.charges.get(a.id)?.text ?? '').own) { endSub(s, a); if (e.origin?.kind === 'task-notification') { const id = /<task-id>([^<]+)<\/task-id>/.exec(e.text)?.[1]; if (id) a.owned.delete(id); } } } if (!e.agentId) { cancel($, s, 'busy', true); s.busy = true; queueLog($, s, 'cancel'); } return next(e); });
  on('turn.step', async function* ($, e, next) {
    if (e.agentId) {
      const charge = s.charges.get(e.agentId), a = charge?.turnId === e.turnId ? charge.a : subState(s, e.agentId), epoch = a.epoch, sentAt = await $.clock.now(), previous = a.anchor;
      a.requestTurn = e.turnId; const result = yield* next(e), u = result.usage;
      if (a.epoch !== epoch || s.subagents.get(a.id) !== a) return result;
      if (u && u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) {
        if (previous) a.observed = observeTtl({ gapMs: sentAt - previous.at, read: u.cache_read_input_tokens, prevContext: previous.context }) ?? a.observed;
        a.ttl = resolveTtl(s.ttlEnv, a.observed, 'subagent');
        a.anchor = { at: sentAt, context: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, tail: u.output_tokens, model: u.model, ttl: a.ttl.ttl, ttlSource: a.ttl.source };
      } else a.anchor = null;
      s.now = await $.clock.now(); await logSub($, s, a, 'step', a.anchor ? 'eligible' : 'usage-unknown'); return result;
    }
    cancel($, s, 'busy', true); s.busy = true; s.typing = false;
    const epoch = s.epoch, id = s.id, sentAt = await $.clock.now(), previous = s.anchor, result = yield* next(e), u = result.usage;
    if (s.epoch !== epoch || s.id !== id) return result;
    if (s.closing) { const closed = s.closing; s.closing = null; s.lastOutcome = closeLedger({ ledger: budgetLedger({ context: closed.context, ttl: s.ttl.ttl, spent: closed.spent, warms: closed.warms }), waitStartedAt: closed.started, originalExpiryAt: closed.originalExpiry, returnedAt: sentAt, usage: u, settled: !closed.pending, samePrefix: u ? u.model === closed.model && u.cache_read_input_tokens >= closed.context * 0.9 : null }); s.session = recordOutcome(s.session, s.lastOutcome); $.ui.toast(formatOutcome(s.lastOutcome), { timeoutMs: 10000 }); }
    if (u && u.cache_read_input_tokens + u.cache_creation_input_tokens > 0) { if (previous) s.observed = observeTtl({ gapMs: sentAt - previous.at, read: u.cache_read_input_tokens, prevContext: previous.context }) ?? s.observed; s.ttl = resolveTtl(s.ttlEnv, s.observed); s.anchor = { at: sentAt, context: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, tail: u.output_tokens, model: u.model, ttl: s.ttl.ttl, ttlSource: s.ttl.source }; } else s.anchor = null;
    s.now = await $.clock.now(); await persist($, s); await log($, s, 'step'); return result;
  });
  on('turn.start', async ($, e, next) => {
    if (e.agentId) {
      const charge = s.charges.get(e.agentId), a = s.subagents.get(e.agentId) ?? charge?.a ?? subState(s, e.agentId);
      if (charge && warmReceipt([{ role: 'user', text: e.text, toolUses: [] }], charge.text).own && !charge.turnId) { charge.turnId = e.turnId; if (a.pending) a.pending.turnId = e.turnId; }
      else if (charge?.turnId !== e.turnId) endSub(s, a);
    }
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      const a = subState(s, e.agentId);
      if (a.pending) { endSub(s, a); $.ui.toast('cache-keepwarm · sub-agent warm called a tool; episode stopped'); }
      if (!result.isError && !result.deny) { const item = ownedFromTool(e.tool, e, result.result); if (item) a.owned.set(item.id, item); }
    }
    if (e.tool === 'TaskStop' && typeof e.task_id === 'string' && !result.isError && !result.deny) for (const a of s.subagents.values()) { if (a.owned.has(e.task_id)) { a.owned.delete(e.task_id); endSub(s, a); } }
    return result;
  });
  on('classic.SubagentStop', async ($, e, next) => {
    const a = s.subagents.get(e.agent_id); if (a) { const snapshot = fromStop(e.background_tasks, s.now); if (snapshot.known) a.owned = new Map([...a.owned].filter(([id]) => snapshot.items.some(i => i.id === id))); }
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) {
      const charge = s.charges.get(e.agentId), a = charge?.a ?? s.subagents.get(e.agentId);
      if (a) {
        s.now = await $.clock.now();
        // A native send can skip this plugin's own start/step hooks. Completion is universal; bind it to the actual receipt.
        if (charge && !charge.turnId) {
          let messages;
          try { messages = await $.session.messages({ agentId: e.agentId }); }
          catch (error) { $.ui.toast(`cache-keepwarm · sub-agent receipt failed (${String(error)})`); endSub(s, a); return result; }
          if (!Array.isArray(messages)) { $.ui.toast(`cache-keepwarm · sub-agent receipt refused (${messages.deny})`); endSub(s, a); }
          else {
            const receipt = warmReceipt(messages, charge.text);
            if (receipt.own) {
              charge.turnId = e.turnId;
              if (a.epoch === charge.epoch && e.usage) a.anchor = { at: charge.at, context: e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens, tail: e.usage.output_tokens, model: e.usage.model, ttl: a.ttl.ttl, ttlSource: a.ttl.source };
              if (receipt.tools) { $.ui.toast('cache-keepwarm · sub-agent warm called a tool; episode stopped'); endSub(s, a); }
            }
          }
        }
        await completeSub($, s, a, e.turnId, e.usage, e.reason === 'answer');
      }
    }
    return result;
  });
  on('classic.Stop', async ($, e, next) => {
    const previous = s.episode; s.timer?.cancel(); s.tick?.cancel(); s.timer = undefined; s.tick = undefined; const epoch = ++s.epoch; s.busy = false; s.typing = false;
    s.now = await $.clock.now(); if (s.epoch !== epoch) return next(e);
    const snapshot = fromStop(e.background_tasks, s.now); if (snapshot.known) s.seen = firstSeen(snapshot.items, s.seen, s.now); s.ended = snapshot.ended?.[0]; s.ttlEnv = await readTtlEnv($); s.ttl = resolveTtl(s.ttlEnv, s.observed);
    const draft = await $.prompt.read(); if (s.epoch !== epoch) return next(e); s.typing = draft.text.length > 0;
    s.episode = { pending: false, items: snapshot.items, known: snapshot.known, started: previous?.started ?? s.now, originalExpiry: previous?.originalExpiry ?? (s.anchor?.at ?? s.now) + TTL_MS[s.ttl.ttl], context: s.anchor?.context ?? 0, model: s.anchor?.model ?? '', spent: previous?.spent ?? 0, warms: previous?.warms ?? 0, epoch };
    await arm($, s, epoch); return next(e);
  });
  on('session.compact', async ($, e, next) => {
    const c = compactFacts(e);
    if (compactResets(c)) { endSubs(s); cancel($, s, 'idle'); s.anchor = null; s.observed = null; s.closing = null; await persist($, s); }
    await log($, s, 'compact', s.reason, undefined, s.episode, undefined, c); return next(e);
  });
  on('classic.PostModelSwitch', async ($, e, next) => { endSubs(s); cancel($, s, 'idle'); s.anchor = null; s.observed = null; s.closing = null; await persist($, s); await log($, s, 'model-switch'); return next(e); });
  on('session.end', async ($, e, next) => {
    if (s.inFlight) s.departing ??= { ...s, inactive: true };
    departSubs(s); endSubs(s); cancel($, s, 'idle'); s.closing = null; s.override = null; await persist($, s);
    s.anchor = null; s.seen.clear(); s.id = ''; s.session = emptySessionLedger(); s.busy = false; s.typing = false; s.lastOutcome = null; s.observed = null; s.rows = []; s.logFailed = false; s.logError = undefined; s.ttl = resolveTtl(s.ttlEnv, null);
    const result = await next(e);
    if (e.reason === 'clear' || e.reason === 'resume') {
      s.id = result.sessionId; s.now = await $.clock.now();
      if (e.reason === 'resume') {
        await restore($, s, false);
      }
    }
    return result;
  });
  on('command.run', { command: 'keepwarm' }, async ($, e) => { const action = parseControl(e.args); if (action === 'invalid') return { text: 'Usage: /keepwarm [on|off|status]' }; if (action !== 'status') await toggle($, s, action === 'on'); s.now = await $.clock.now(); return { text: formatState(view(s)) + subStatus(s) }; });
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!s.options.band || e.component !== 'AbovePrompt' || e.props.hasSurvey) return next(e);
    s.now = await $.clock.now(); const band = formatBand(view(s)), { Box, Text, Button } = $.ui.resolve(e);
    return Box({ flexDirection: 'row', children: [Text({ wrap: 'truncate-end', children: `${band.state === 'warm' ? '●' : '○'} ${band.text}${subStatus(s)} ` }), Button({ key: 'keepwarm', onPress: () => { void toggle($, s, !enabled(s)).catch(error => { $.ui.toast(`cache-keepwarm · toggle failed (${String(error)})`); }); }, children: band.toggleLabel })] });
  });
};
