export type OptionEnv = Partial<Record<'CACHE_KEEPWARM_ENABLED' | 'CACHE_KEEPWARM_MIN_CONTEXT' | 'CACHE_KEEPWARM_MAX_POKES' | 'CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT' | 'CACHE_KEEPWARM_LOG_DIR' | 'CACHE_KEEPWARM_BAND' | 'CACHE_KEEPWARM_SUBAGENTS', string>>;
export interface Options { enabled: boolean; minContext: number; maxPokes: number; subagentMinContext: number; logDir: string; band: boolean; subagents: boolean; bad: string[] }
export const ENV = { enabled: 'CACHE_KEEPWARM_ENABLED', minContext: 'CACHE_KEEPWARM_MIN_CONTEXT', maxPokes: 'CACHE_KEEPWARM_MAX_POKES', subagentMinContext: 'CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT', logDir: 'CACHE_KEEPWARM_LOG_DIR', band: 'CACHE_KEEPWARM_BAND', subagents: 'CACHE_KEEPWARM_SUBAGENTS' } as const;
export function resolveOptions(options: Record<string, unknown>, env: OptionEnv): Options {
  const defaults = { enabled: true, minContext: 20000, maxPokes: 4, subagentMinContext: 100000, logDir: '', band: true, subagents: true };
  const result: Options = { ...defaults, bad: [] };
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const name = ENV[key], raw = env[name];
    const fromEnv = typeof raw === 'string' && raw.trim() !== '';
    const value = fromEnv ? raw.trim() : options[key];
    if (value === undefined) continue;
    let parsed: unknown = value;
    if (key === 'enabled' || key === 'band' || key === 'subagents') {
      if (typeof value === 'string' && /^(1|0|true|false)$/i.test(value)) parsed = /^(1|true)$/i.test(value);
      if (typeof parsed !== 'boolean') parsed = undefined;
    } else if (key === 'logDir') {
      if (typeof value !== 'string') parsed = undefined;
    } else {
      parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isSafeInteger(parsed) || Number(parsed) < (key === 'subagentMinContext' ? 0 : 1)) parsed = undefined;
    }
    if (parsed === undefined) { result.bad.push(fromEnv ? name : key); continue; }
    Object.assign(result, { [key]: parsed });
  }
  return result;
}
