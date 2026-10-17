import type { Ttl } from './ttl.ts';
export const WARM_1H = false;
export const SAFETY_MS = 15_000;
export const TTL_MS = { '5m': 300_000, '1h': 3_600_000 } as const;
export function nextFireAt(_input: { lastSendAt: number; ttl: Ttl }): number { throw new Error('not built'); }
export function isLate(_input: { lastSendAt: number; ttl: Ttl; now: number }): boolean { throw new Error('not built'); }
