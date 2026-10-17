import type { AgentInfo, ClassicHookInputs } from 'claude-code';
export type TaskSummary = NonNullable<ClassicHookInputs['Stop']['background_tasks']>[number];
export interface WaitItem { id: string; kind: string; label: string }
export interface EndedItem { item: WaitItem; ended: 'completed' | 'failed' | 'killed' }
export interface WaitSnapshot { known: boolean; items: WaitItem[]; ended?: EndedItem[] }
export function sanitizeLabel(_text: string): string { throw new Error('not built'); }
export function fromStop(_tasks: readonly TaskSummary[] | undefined, _now: number): WaitSnapshot { throw new Error('not built'); }
export function reconcile(_items: readonly WaitItem[], _agents: readonly Pick<AgentInfo, 'id' | 'status'>[]): { items: WaitItem[]; ended: EndedItem[] } { throw new Error('not built'); }
export function firstSeen(_items: readonly WaitItem[], _previous: ReadonlyMap<string, number>, _now: number): Map<string, number> { throw new Error('not built'); }
export function leaseExpired(_input: { firstSeenAt: number; maxWaitMinutes: number; now: number }): boolean { throw new Error('not built'); }
