import type { Ttl, TtlSource } from './ttl.ts';
import type { WaitItem } from './waits.ts';
import type { BudgetLedger, ClosedLedger, SessionLedger } from './budget.ts';
import type { ReasonCode } from './decision.ts';
export type StatusItem = Pick<WaitItem, 'kind' | 'label'> & { firstSeenAt: number };
export interface WaitingStatus { items: readonly StatusItem[]; now: number; warms: number; nextInMs: number; ttlSource: TtlSource; reasonCode?: string }
export type StopReason = 'lease' | 'budget' | 'late' | 'ended' | 'error' | 'inactive' | 'small' | 'unknown' | '1h-unproven' | 'timer' | 'decision';
export interface StopStatus { reason: StopReason; item?: Pick<WaitItem, 'kind' | 'label'>; minutes?: number; warms?: number; lateMinutes?: number; detail?: string; context?: number; minContext?: number; reasonCode?: string }
export interface StatusView { enabled: boolean; source: 'launch' | 'session'; reason: ReasonCode; items: readonly StatusItem[]; now: number; warms: number; nextInMs: number; ttl: Ttl; ttlSource: TtlSource; context: number | null; ledger: BudgetLedger | null; session: SessionLedger; lastOutcome: ClosedLedger | null; warnings?: readonly string[] }
const prefix = 'cache-keepwarm · ';
function duration(ms: number): string { const minutes = Math.max(0, Math.floor(ms / 60000)); return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`; }
function label(item: Pick<WaitItem, 'kind' | 'label'> | undefined): string { return item ? `${item.kind} "${item.label}"` : 'work'; }
function code(text: string, reason?: string): string { return text + (reason ? ` [${reason}]` : ''); }
const reasons: Record<ReasonCode, string> = {
  'agent-not-waiting': 'stopped: sub-agent is not waiting', eligible: 'warming', off: 'off', busy: 'not warming: turn running', typing: 'not warming: user typing', stale: 'stopped: stale wait', 'in-flight': 'warm in flight',
  'inventory-unknown': 'stopped: this Claude Code gives the Stop hook no background_tasks', 'nothing-pending': 'not warming: nothing tracked pending', ended: 'stopped: work ended',
  'usage-unknown': 'not warming: no main request seen since the plugin loaded', 'usage-invalid': 'not warming: invalid cache usage or clock', small: 'not warming: context too small',
  '1h-unproven': 'not warming: 1h refresh unproven', 'cache-cold': 'not warming: cache cold', 'expiry-safety': 'not warming: too close to expiry',
  'wake-unknown': 'not warming: wake capability unknown', 'cannot-wake': 'not warming: work cannot wake chat', lease: 'stopped: wait lease expired, liveness unknown',
  imminent: 'not warming: work expected before expiry', 'wait-window-short': 'not warming: wait window ends before expiry', budget: 'stopped: next warm exceeds budget', marginal: 'not warming: forecast saving marginal',
  'fork-failed': 'stopped: warm failed', 'timer-failed': 'stopped: timer failed', resumed: 'resumed: fresh tracked Stop required', idle: 'on, idle: waiting for tracked work',
};
export function formatWaiting(input: WaitingStatus): string {
  const first = input.items[0];
  const elapsed = first ? input.now - Math.min(...input.items.map(i => i.firstSeenAt)) : 0;
  return code(`${prefix}waiting on ${label(first)}${input.items.length > 1 ? ` +${input.items.length - 1} more` : ''} · ${duration(elapsed)} · warms ${input.warms} · next in ${duration(Math.max(0, input.nextInMs))}${input.ttlSource === 'assumed' ? ' · TTL assumed 5m' : ''}`, input.reasonCode);
}
export function formatStopped(input: StopStatus | undefined): string | undefined {
  if (!input) return undefined;
  let text: string;
  switch (input.reason) {
    case 'lease': text = `stopped: ${label(input.item)} pending ${input.minutes}m with no result, liveness unknown`; break;
    case 'budget': text = `stopped: the next warm would cost more than the rewrite it saves (${input.warms} warms)`; break;
    case 'late': text = `stopped: the cache had already lapsed (timer fired ${input.lateMinutes}m late)`; break;
    case 'ended': text = `stopped: ${label(input.item)} was ${input.detail ?? 'killed'}`; break;
    case 'error': text = `stopped: warm failed (${input.detail})`; break;
    case 'timer': text = `stopped: timer failed (${input.detail})`; break;
    case 'inactive': text = reasons['inventory-unknown']; break;
    case 'small': text = `not warming: context ${input.context?.toLocaleString('en-US')} tokens is under the ${input.minContext?.toLocaleString('en-US')} minimum`; break;
    case '1h-unproven': text = reasons['1h-unproven']; break;
    case 'unknown': text = reasons['usage-unknown']; break;
    case 'decision': text = reasons[input.detail as ReasonCode] ?? `not warming: ${input.detail}`; break;
  }
  return code(prefix + text, input.reasonCode);
}
const eq = (n: number): string => `${Math.round(n / 100) / 10}k-eq`;
export function formatLedger(ledger: BudgetLedger | null, session: SessionLedger): string {
  return `${ledger ? `${ledger.warms} warms · spent ≈ ${eq(ledger.spent)} / ${eq(ledger.allowance)} · protecting ≈ ${eq(ledger.protecting)} rewrite · ` : ''}session ${session.warms} warms, spent ≈ ${eq(session.spent)}, estimated net ≈ ${eq(session.estimatedNet)}${session.unknown ? ` (${session.unknown} unknown)` : ''}`;
}
export function formatState(view: StatusView): string {
  return `${prefix}${view.enabled ? 'on' : 'off'} (${view.source === 'launch' ? 'launch default' : 'session override'}) · ${reasons[view.reason]} [${view.reason}] · ${view.items.length ? `${label(view.items[0])}${view.items.length > 1 ? ` +${view.items.length - 1} more` : ''} · ${duration(view.now - Math.min(...view.items.map(i => i.firstSeenAt)))} · ETA unknown` : 'no current wait'} · ${view.context ?? 'unknown'} tokens · ${formatLedger(view.ledger, view.session)}${view.lastOutcome ? ` · last: ${formatOutcome(view.lastOutcome)}` : ''}${view.warnings?.length ? ' · ' + view.warnings.join(' · ') : ''}`;
}
export function formatBand(view: StatusView): { text: string; state: 'warm' | 'cold' | 'off' | 'unknown'; toggleLabel: string } {
  return { text: formatState(view), state: !view.enabled ? 'off' : view.reason === 'cache-cold' ? 'cold' : view.reason === 'eligible' ? 'warm' : 'unknown', toggleLabel: view.enabled ? '[x] keepwarm' : '[ ] keepwarm' };
}
export function formatOutcome(outcome: ClosedLedger): string {
  return `kept warm across ${duration(outcome.elapsedMs)} · return read ${outcome.readPercent === null ? 'unknown' : outcome.readPercent.toFixed(1) + '%'} from cache · estimated net saved ≈ ${outcome.netSaved === null ? 'unknown' : eq(outcome.netSaved)}`;
}

export function subagentMessage(label: string | undefined, elapsedMs: number): string { return `Cache keep-warm: your prompt cache was about to expire and was kept alive because you are still waiting on ${label || 'your background work'} (${duration(elapsedMs)}). Nothing has changed. Reply exactly K and end your turn; do not call tools.`; }
