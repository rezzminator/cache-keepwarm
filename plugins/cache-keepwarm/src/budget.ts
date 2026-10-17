import type { ModelUsage } from 'claude-code';
import type { Ttl } from './ttl.ts';
export type Usage = Pick<ModelUsage, 'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens'>;
export interface BudgetLedger { context: number; ttl: Ttl; spent: number; warms: number; allowance: number; protecting: number; remaining: number }
export interface ClosedLedger { elapsedMs: number; readPercent: number | null; netSaved: number | null; reason: 'estimated' | 'early' | 'miss' | 'unknown' }
export interface SessionLedger { spent: number; warms: number; episodes: number; estimatedNet: number; unknown: number }
export function rewriteSaved(_input: { context: number; ttl: Ttl }): number { throw new Error('not built'); }
export function warmSpend(_usage: Usage): number { throw new Error('not built'); }
export function warmForecast(_input: { context: number; tail: number }): number { throw new Error('not built'); }
export function allow(_input: { spent: number; forecast: number; saved: number }): boolean { throw new Error('not built'); }
export function budgetLedger(_input: { context: number; ttl: Ttl; spent: number; warms: number }): BudgetLedger { throw new Error('not built'); }
export function closeLedger(_input: { ledger: BudgetLedger; waitStartedAt: number; originalExpiryAt: number; returnedAt: number; usage: Usage | null; samePrefix: boolean | null }): ClosedLedger { throw new Error('not built'); }
export function emptySessionLedger(): SessionLedger { throw new Error('not built'); }
export function recordWarm(_session: SessionLedger, _usage: Usage): SessionLedger { throw new Error('not built'); }
export function recordOutcome(_session: SessionLedger, _outcome: ClosedLedger): SessionLedger { throw new Error('not built'); }
