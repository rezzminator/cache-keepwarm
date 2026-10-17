import type { Ttl, TtlSource } from './ttl.ts';
import type { SessionLedger } from './budget.ts';
export interface Anchor { at: number; context: number; tail: number; model: string; ttl: Ttl; ttlSource: TtlSource }
export interface SavedSession { version: 1; sessionId: string; anchor: Anchor | null; ledger: SessionLedger }
export type RestoreResult = { kind: 'absent' } | { kind: 'restored'; anchor: Anchor | null; ledger: SessionLedger } | { kind: 'rejected'; reason: 'session-mismatch' | 'invalid-record' | 'future-anchor' };
export function restoreAnchor(_value: unknown, _input: { sessionId: string; now: number }): RestoreResult { throw new Error('not built'); }
export function snapshotSession(_input: { sessionId: string; anchor: Anchor | null; ledger: SessionLedger }): SavedSession { throw new Error('not built'); }
