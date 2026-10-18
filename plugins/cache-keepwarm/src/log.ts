import type { Ttl, TtlSource } from './ttl.ts';
import type { BudgetLedger, SessionLedger, Usage } from './budget.ts';
export interface LogRow { at: number; anchorAt?: number; entryTtl?: Ttl; event: string; epoch: number; items: readonly { id: string; kind: string }[]; ttl: Ttl; ttlSource: TtlSource; context: number | null; usage?: Usage; spent: number; reason?: string; warms?: number; ledger?: BudgetLedger; session?: SessionLedger }
export function appendLog(rows: readonly LogRow[], row: LogRow): LogRow[] {
  return [...rows, row].slice(-500).map(r => ({ at: r.at, ...(r.anchorAt === undefined ? {} : { anchorAt: r.anchorAt }), ...(r.entryTtl === undefined ? {} : { entryTtl: r.entryTtl }), event: r.event, epoch: r.epoch, items: r.items.map(({ id, kind }) => ({ id, kind })), ttl: r.ttl, ttlSource: r.ttlSource, context: r.context, spent: r.spent,
    ...(r.reason === undefined ? {} : { reason: r.reason }), ...(r.warms === undefined ? {} : { warms: r.warms }),
    ...(r.usage ? { usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, cache_read_input_tokens: r.usage.cache_read_input_tokens, cache_creation_input_tokens: r.usage.cache_creation_input_tokens } } : {}),
    ...(r.ledger ? { ledger: { context: r.ledger.context, ttl: r.ledger.ttl, spent: r.ledger.spent, warms: r.ledger.warms, allowance: r.ledger.allowance, protecting: r.ledger.protecting, remaining: r.ledger.remaining } } : {}),
    ...(r.session ? { session: { spent: r.session.spent, warms: r.session.warms, episodes: r.session.episodes, estimatedNet: r.session.estimatedNet, unknown: r.session.unknown } } : {}),
  }));
}
export interface LogStat { kind: 'file' | 'dir' | 'other'; isLink: boolean; realPath?: string }
export type LogBase = { ok: true; base: string; pinned: string | null } | { ok: false; reason: 'log directory moved' | 'log directory is not a directory' | 'log directory unresolved' };
export function logFileName(sessionId: string, instance: string): string { return `${encodeURIComponent(sessionId)}.${encodeURIComponent(instance)}.jsonl`; }
export function logBase({ dir, stat, pinned }: { dir: string; stat: LogStat | null; pinned: string | null }): LogBase {
  if (!stat) return pinned === null ? { ok: true, base: dir, pinned: null } : { ok: false, reason: 'log directory moved' };
  if (stat.kind !== 'dir') return { ok: false, reason: 'log directory is not a directory' };
  if (!stat.realPath) return { ok: false, reason: 'log directory unresolved' };
  if (pinned !== null && stat.realPath !== pinned) return { ok: false, reason: 'log directory moved' };
  return { ok: true, base: stat.realPath, pinned: stat.realPath };
}
export function leafRefusal(stat: LogStat | null): string | null { return stat && (stat.isLink || stat.kind !== 'file') ? 'log target is a link or not a regular file' : null; }
