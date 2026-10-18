import type { Ttl } from './ttl.ts';
export type ReasonCode = 'eligible' | 'off' | 'busy' | 'typing' | 'stale' | 'in-flight' | 'inventory-unknown' | 'nothing-pending' | 'ended' | 'usage-unknown' | 'usage-invalid' | 'small' | '1h-unproven' | 'cache-cold' | 'expiry-safety' | 'wake-unknown' | 'cannot-wake' | 'lease' | 'imminent' | 'wait-window-short' | 'budget' | 'marginal' | 'fork-failed' | 'timer-failed' | 'resumed' | 'idle';
export interface DecisionItem { id: string; expired: boolean; leaseEndsAt: number; expectedBackAt: number | null; wake: 'yes' | 'no' | 'unknown' }
export interface DecisionInput { fault?: 'fork-failed' | 'timer-failed'; enabled: boolean; busy: boolean; typing: boolean; currentEpoch: boolean; inFlight: boolean; known: boolean; context: number | null; minContext: number; lastSendAt: number | null; now: number; ttl: Ttl; warm1h: boolean; items: readonly DecisionItem[]; endedId?: string; spent: number; forecast: number; saved: number }
export interface Decision { action: 'warm' | 'skip' | 'stop'; reason: ReasonCode; items: string[]; itemId?: string }
export function decideWarm(input: DecisionInput): Decision {
  const stop = (reason: ReasonCode, action: Decision['action'] = 'stop', itemId?: string): Decision => ({ action, reason, items: [], ...(itemId ? { itemId } : {}) });
  if (!input.currentEpoch) return stop('stale');
  if (!input.enabled) return stop('off');
  if (input.busy) return stop('busy');
  if (input.typing) return stop('typing');
  if (input.fault) return stop(input.fault);
  if (input.inFlight) return stop('in-flight', 'skip');
  if (!input.known) return stop('inventory-unknown');
  if (!input.items.length) return stop(input.endedId ? 'ended' : 'nothing-pending', 'stop', input.endedId);
  if (input.context === null || input.lastSendAt === null) return stop('usage-unknown');
  if (![input.context, input.lastSendAt, input.now, input.spent, input.forecast, input.saved, input.minContext].every(n => Number.isFinite(n) && n >= 0) || input.now < input.lastSendAt) return stop('usage-invalid');
  if (input.context < input.minContext) return stop('small');
  if (input.ttl === '1h' && !input.warm1h) return stop('1h-unproven');
  const expiry = input.lastSendAt + (input.ttl === '5m' ? 300000 : 3600000);
  if (input.now >= expiry) return stop('cache-cold');
  if (input.now >= expiry - 15000) return stop('expiry-safety');
  const live = input.items.filter(item => !item.expired && item.leaseEndsAt > input.now);
  if (!live.length) return stop('lease', 'stop', [...input.items].sort((a, b) => a.leaseEndsAt - b.leaseEndsAt)[0]?.id);
  const waking = live.filter(item => item.wake === 'yes');
  if (!waking.length) return stop(live.some(item => item.wake === 'unknown') ? 'wake-unknown' : 'cannot-wake');
  const long = waking.filter(item => item.leaseEndsAt > expiry);
  if (!long.length) return stop('wait-window-short');
  const needed = long.filter(item => item.expectedBackAt === null || item.expectedBackAt > expiry);
  if (!needed.length) return stop('imminent', 'skip');
  if (input.spent + input.forecast > input.saved) return stop('budget');
  if (input.saved - input.spent - input.forecast + 1e-9 < input.forecast * 0.1) return stop('marginal');
  return { action: 'warm', reason: 'eligible', items: needed.map(item => item.id) };
}
