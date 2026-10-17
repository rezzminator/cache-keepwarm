import type { Ttl } from './ttl.ts';
export type ReasonCode = 'eligible' | 'off' | 'busy' | 'typing' | 'stale' | 'in-flight' | 'inventory-unknown' | 'nothing-pending' | 'ended' | 'usage-unknown' | 'usage-invalid' | 'small' | '1h-unproven' | 'cache-cold' | 'expiry-safety' | 'wake-unknown' | 'cannot-wake' | 'lease' | 'imminent' | 'wait-window-short' | 'budget' | 'marginal' | 'fork-failed' | 'timer-failed' | 'resumed' | 'idle';
export interface DecisionItem { id: string; expired: boolean; leaseEndsAt: number; expectedBackAt: number | null; wake: 'yes' | 'no' | 'unknown' }
export interface DecisionInput { enabled: boolean; busy: boolean; typing: boolean; currentEpoch: boolean; inFlight: boolean; known: boolean; context: number | null; minContext: number; lastSendAt: number | null; now: number; ttl: Ttl; warm1h: boolean; items: readonly DecisionItem[]; endedId?: string; spent: number; forecast: number; saved: number }
export interface Decision { action: 'warm' | 'skip' | 'stop'; reason: ReasonCode; items: string[]; itemId?: string }
export function decideWarm(_input: DecisionInput): Decision { throw new Error('not built'); }
