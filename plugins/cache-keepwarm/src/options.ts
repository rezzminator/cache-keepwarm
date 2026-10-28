export type OptionEnv = Partial<Record<'CACHE_KEEPWARM_ENABLED' | 'CACHE_KEEPWARM_MIN_CONTEXT' | 'CACHE_KEEPWARM_MAX_POKES' | 'CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT' | 'CACHE_KEEPWARM_SUBAGENTS' | 'CACHE_KEEPWARM_STATUS', string>>;
export interface Options { enabled: boolean; minContext: number; maxPokes: number; subagentMinContext: number; subagents: boolean; status: boolean; bad: string[] }
export const ENV = { enabled: 'CACHE_KEEPWARM_ENABLED', minContext: 'CACHE_KEEPWARM_MIN_CONTEXT', maxPokes: 'CACHE_KEEPWARM_MAX_POKES', subagentMinContext: 'CACHE_KEEPWARM_SUBAGENT_MIN_CONTEXT', subagents: 'CACHE_KEEPWARM_SUBAGENTS', status: 'CACHE_KEEPWARM_STATUS' } as const;
export function resolveOptions(options: Record<string, unknown>, env: OptionEnv): Options {
  const defaults = { enabled: true, minContext: 20000, maxPokes: 4, subagentMinContext: 100000, subagents: true, status: true };
  const result: Options = { ...defaults, bad: [] };
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const name = ENV[key], raw = env[name];
    const fromEnv = typeof raw === 'string' && raw.trim() !== '';
    const value = fromEnv ? raw.trim() : options[key];
    if (value === undefined) continue;
    let parsed: unknown = value;
    if (key === 'enabled' || key === 'subagents' || key === 'status') {
      if (typeof value === 'string' && /^(1|0|true|false)$/i.test(value)) parsed = /^(1|true)$/i.test(value);
      if (typeof parsed !== 'boolean') parsed = undefined;
    } else {
      parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
      if (!Number.isSafeInteger(parsed) || Number(parsed) < (key === 'subagentMinContext' ? 0 : 1)) parsed = undefined;
    }
    if (parsed === undefined) { result.bad.push(fromEnv ? name : key); continue; }
    Object.assign(result, { [key]: parsed });
  }
  return result;
}
