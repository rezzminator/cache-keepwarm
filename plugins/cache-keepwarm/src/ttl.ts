export type Ttl = '5m' | '1h';
export type TtlSource = 'force-5m' | 'env' | 'observed' | 'env-1h' | 'assumed';
export type TtlEnv = Partial<Record<'FORCE_PROMPT_CACHING_5M' | 'CLAUDE_CODE_PROMPT_CACHE_TTL' | 'ENABLE_PROMPT_CACHING_1H', string>>;
export interface TtlResolution { ttl: Ttl; source: TtlSource }
export function resolveTtl(_env: TtlEnv, _observed: Ttl | null): TtlResolution { throw new Error('not built'); }
export function observeTtl(_input: { gapMs: number; read: number; prevContext: number }): Ttl | null { throw new Error('not built'); }
