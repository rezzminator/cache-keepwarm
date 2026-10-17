export type OptionEnv = Partial<Record<'CACHE_KEEPWARM_ENABLED' | 'CACHE_KEEPWARM_MIN_CONTEXT' | 'CACHE_KEEPWARM_MAX_WAIT_MINUTES' | 'CACHE_KEEPWARM_LOG_DIR' | 'CACHE_KEEPWARM_BAND', string>>;
export interface Options { enabled: boolean; minContext: number; maxWaitMinutes: number; logDir: string; band: boolean; bad: string[] }
export const ENV = { enabled: 'CACHE_KEEPWARM_ENABLED', minContext: 'CACHE_KEEPWARM_MIN_CONTEXT', maxWaitMinutes: 'CACHE_KEEPWARM_MAX_WAIT_MINUTES', logDir: 'CACHE_KEEPWARM_LOG_DIR', band: 'CACHE_KEEPWARM_BAND' } as const;
export function resolveOptions(_options: Record<string, unknown>, _env: OptionEnv): Options { throw new Error('not built'); }
