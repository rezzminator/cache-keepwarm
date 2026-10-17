import type { Ttl, TtlSource } from './ttl.ts';
import type { WaitItem } from './waits.ts';
import type { BudgetLedger, ClosedLedger, SessionLedger } from './budget.ts';
import type { ReasonCode } from './decision.ts';
export type StatusItem = Pick<WaitItem, 'kind' | 'label'> & { firstSeenAt: number };
export interface WaitingStatus { items: readonly StatusItem[]; now: number; warms: number; nextInMs: number; ttlSource: TtlSource; reasonCode?: string }
export type StopReason = 'lease' | 'budget' | 'late' | 'ended' | 'error' | 'inactive' | 'small' | 'unknown' | '1h-unproven' | 'timer' | 'decision';
export interface StopStatus { reason: StopReason; item?: Pick<WaitItem, 'kind' | 'label'>; minutes?: number; warms?: number; lateMinutes?: number; detail?: string; context?: number; minContext?: number; reasonCode?: string }
export interface StatusView { enabled: boolean; source: 'launch' | 'session'; reason: ReasonCode; items: readonly StatusItem[]; now: number; warms: number; nextInMs: number; ttl: Ttl; ttlSource: TtlSource; context: number | null; ledger: BudgetLedger | null; session: SessionLedger; lastOutcome: ClosedLedger | null }
export function formatWaiting(_input: WaitingStatus): string { throw new Error('not built'); }
export function formatStopped(_input: StopStatus | undefined): string | undefined { throw new Error('not built'); }
export function formatLedger(_ledger: BudgetLedger | null, _session: SessionLedger): string { throw new Error('not built'); }
export function formatState(_view: StatusView): string { throw new Error('not built'); }
export function formatBand(_view: StatusView): { text: string; state: 'warm' | 'cold' | 'off' | 'unknown'; toggleLabel: string } { throw new Error('not built'); }
export function formatOutcome(_outcome: ClosedLedger): string { throw new Error('not built'); }
