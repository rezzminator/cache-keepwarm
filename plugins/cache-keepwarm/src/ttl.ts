export type Ttl = '5m' | '1h';
export type TtlSource = 'force-5m' | 'env' | 'observed' | 'env-1h' | 'assumed';
export type TtlEnv = Partial<Record<'FORCE_PROMPT_CACHING_5M' | 'CLAUDE_CODE_PROMPT_CACHE_TTL' | 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL' | 'ENABLE_PROMPT_CACHING_1H', string>>;
export interface TtlResolution { ttl: Ttl; source: TtlSource }
export function resolveTtl(env: TtlEnv, observed: Ttl | null, kind?: 'subagent'): TtlResolution {
  if (kind === 'subagent') {
    const explicit = subagentTtl(env);
    return explicit.source === 'assumed' && observed ? { ttl: observed, source: 'observed' } : explicit;
  }
  if (env.FORCE_PROMPT_CACHING_5M === '1') return { ttl: '5m', source: 'force-5m' };
  if (env.CLAUDE_CODE_PROMPT_CACHE_TTL === '5m' || env.CLAUDE_CODE_PROMPT_CACHE_TTL === '1h') return { ttl: env.CLAUDE_CODE_PROMPT_CACHE_TTL, source: 'env' };
  if (observed) return { ttl: observed, source: 'observed' };
  if (env.ENABLE_PROMPT_CACHING_1H === '1') return { ttl: '1h', source: 'env-1h' };
  return { ttl: '5m', source: 'assumed' };
}
/** The TTL a sub-agent's request writes: 5m unless the environment names 1h (read from the Claude Code 2.1.302 source). A
 * `subagentPromptCacheTtl` setting is not visible to a plugin and reads as 5m, which warms early, never late. */
export function subagentTtl(env: TtlEnv): TtlResolution {
  if (env.FORCE_PROMPT_CACHING_5M === '1') return { ttl: '5m', source: 'force-5m' };
  if (env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL === '5m' || env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL === '1h') return { ttl: env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL, source: 'env' };
  if (env.ENABLE_PROMPT_CACHING_1H === '1') return { ttl: '1h', source: 'env-1h' };
  return { ttl: '5m', source: 'assumed' };
}
export function observeTtl({ gapMs, read, prevContext }: { gapMs: number; read: number; prevContext: number }): Ttl | null {
  if (![gapMs, read, prevContext].every(Number.isFinite) || prevContext <= 0 || read < 0 || gapMs < 330000 || gapMs > 3300000) return null;
  return read / prevContext >= 0.9 ? '1h' : '5m';
}
