export type CompactTrigger = 'manual' | 'auto' | 'plugin' | 'precompute' | 'unknown';
export interface CompactFacts { trigger: CompactTrigger; agentId?: string }
const TRIGGERS: readonly string[] = ['manual', 'auto', 'plugin', 'precompute'];
/** The metadata of one `session.compact` the log keeps: its trigger (an unrecognised one reads `unknown`) and, for a sub-agent's or a fork's own loop, its agentId. Never the instructions or the messages. */
export function compactFacts(input: { trigger?: unknown; agentId?: unknown }): CompactFacts {
  const trigger = typeof input.trigger === 'string' && TRIGGERS.includes(input.trigger) ? input.trigger as CompactTrigger : 'unknown';
  return { trigger, ...(typeof input.agentId === 'string' && input.agentId ? { agentId: input.agentId } : {}) };
}
/** Whether a compaction invalidates the send anchors: `precompute` installs nothing (its result waits for the next compaction), so the prefix and every anchor stand; every other trigger, an unknown one included, resets. */
export function compactResets(facts: CompactFacts): boolean { return facts.trigger !== 'precompute'; }
