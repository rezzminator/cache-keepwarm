import type { AgentInfo, ClassicHookInputs } from 'claude-code';
export type TaskSummary = NonNullable<ClassicHookInputs['Stop']['background_tasks']>[number];
export interface WaitItem { id: string; kind: string; label: string }
export interface EndedItem { item: WaitItem; ended: 'completed' | 'failed' | 'killed' }
export interface WaitSnapshot { known: boolean; items: WaitItem[]; ended?: EndedItem[] }
export function sanitizeLabel(text: string): string {
  const clean = text.replace(/[\u0000-\u0008\u000e-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  return chars.length > 40 ? chars.slice(0, 40).join('') + '…' : clean;
}
export function fromStop(tasks: readonly TaskSummary[] | undefined, _now: number): WaitSnapshot {
  if (!Array.isArray(tasks)) return { known: false, items: [] };
  const items: WaitItem[] = [], ended: EndedItem[] = [];
  for (const task of tasks) {
    const kind = task.type === 'subagent' ? 'agent' : task.type === 'shell' ? 'command' : task.type;
    const item = { id: task.id, kind, label: sanitizeLabel(task.type === 'shell' ? task.command || task.description : task.description) };
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'killed') ended.push({ item, ended: task.status });
    else if (!items.some(other => other.id === item.id)) items.push(item);
  }
  return { known: true, items, ...(ended.length ? { ended } : {}) };
}
export function reconcile(items: readonly WaitItem[], agents: readonly Pick<AgentInfo, 'id' | 'status'>[]): { items: WaitItem[]; ended: EndedItem[] } {
  const kept: WaitItem[] = [], ended: EndedItem[] = [];
  const statuses = new Map(agents.map(agent => [agent.id, agent.status]));
  for (const item of items) {
    const status = item.kind === 'agent' ? statuses.get(item.id) : undefined;
    if (status === 'completed' || status === 'failed' || status === 'killed') ended.push({ item, ended: status });
    else kept.push(item);
  }
  return { items: kept, ended };
}
export function firstSeen(items: readonly WaitItem[], previous: ReadonlyMap<string, number>, now: number): Map<string, number> {
  return new Map(items.map(item => [item.id, Math.min(previous.get(item.id) ?? now, now)]));
}
export function leaseExpired({ firstSeenAt, maxWaitMinutes, now }: { firstSeenAt: number; maxWaitMinutes: number; now: number }): boolean {
  return now - firstSeenAt >= maxWaitMinutes * 60000;
}
