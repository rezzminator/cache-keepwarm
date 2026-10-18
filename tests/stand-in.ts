import type { EngineInterface, On, PluginOptions } from 'claude-code';
import { register } from '../plugins/cache-keepwarm/hooks/cache-keepwarm.ts';
export class Harness {
  now = 1792247410124; status: string | undefined; statuses: (string | undefined)[] = []; toasts: string[] = [];
  handlers = new Map<string, { matcher: Record<string, unknown>; fn: Function }[]>();
  timers: { at: number; interval: number; active: boolean; fn: () => unknown }[] = [];
  forks: unknown[] = []; lists = 0; writes: string[] = []; paths: string[] = []; statImpl: ((path: string, options?: unknown) => Promise<unknown>) | null = null; values = new Map<string, unknown>(); commands: unknown[] = [];
  draft = ''; id = 'session-1'; env: Record<string, string> = {}; loadError: unknown;
  agents = [{ id: 'a', status: 'waiting' }]; writeError: Error | null = null; writeImpl: (() => Promise<void>) | null = null; storeError: Error | null = null;
  forkResult: unknown = { isAnswered: true, text: 'K', usage: { input_tokens: 25, output_tokens: 3, cache_read_input_tokens: 49745, cache_creation_input_tokens: 807 } };
  notifyFork!: () => void; forkStarted = new Promise<void>(resolve => { this.notifyFork = resolve; });
  forkImpl: (() => Promise<unknown>) | null = null;
  engine: EngineInterface;
  constructor(options: PluginOptions = {}, env: Record<string, string> = {}) {
    this.env = env;
    const timer = (ms: number, fn: () => unknown, interval: number) => {
      const t = { at: this.now + ms, fn, interval, active: true }; this.timers.push(t);
      return { cancel: () => { t.active = false; } };
    };
    this.engine = {
      env: { get: async (name: string) => this.env[name] },
      clock: { now: async () => this.now, after: (ms: number, fn: () => unknown) => timer(ms, fn, 0), every: (ms: number, fn: () => unknown) => timer(ms, fn, ms) },
      prompt: { read: async () => ({ text: this.draft }) },
      session: { id: async () => this.id },
      agent: { list: async () => { this.lists++; return this.agents; } },
      model: { fork: async (input: unknown) => { this.forks.push(input); this.notifyFork(); if (this.forkImpl) return this.forkImpl(); if (this.forkResult instanceof Error) throw this.forkResult; return this.forkResult; } },
      store: { get: async (key: string) => { if (this.storeError) throw this.storeError; return this.values.get(key); }, set: async (key: string, value: unknown) => { if (this.storeError) throw this.storeError; this.values.set(key, value); }, keys: async () => { if (this.storeError) throw this.storeError; return [...this.values.keys()]; }, delete: async (key: string) => { if (this.storeError) throw this.storeError; this.values.delete(key); } },
      command: { register: (value: unknown) => this.commands.push(value) },
      fs: { stat: async (path: string, options?: unknown) => { if (this.statImpl) return this.statImpl(path, options); throw new Error(`ENOENT: no such file or directory, stat '${path}'`); }, write: async (path: string, text: string) => { if (this.writeError) throw this.writeError; if (this.writeImpl) await this.writeImpl(); this.paths.push(path); this.writes.push(text); } },
      ui: { status: (text: string | undefined) => { this.status = text; this.statuses.push(text); }, toast: (text: string) => this.toasts.push(text), invalidate: () => {}, resolve: () => ({ Box: (props: unknown, ...children: unknown[]) => ({ props, children }), Text: (props: unknown, ...children: unknown[]) => ({ props, children }), Button: (props: unknown, ...children: unknown[]) => ({ props, children }) }) },
    } as unknown as EngineInterface;
    const on = ((event: string, ...args: unknown[]) => {
      const matcher = args.length > 1 ? args[0] as Record<string, unknown> : {};
      const fn = args.at(-1) as Function;
      this.handlers.set(event, [...this.handlers.get(event) ?? [], { matcher, fn }]);
      return { catch: () => {} };
    }) as unknown as On;
    try { register(on, options); } catch (error) { this.loadError = String(error); }
  }
  async emit(event: string, input: any = {}, result: any = {}) {
    let forwarded: unknown;
    for (const { matcher, fn } of this.handlers.get(event) ?? []) {
      if (!Object.entries(matcher).every(([key, value]) => input[key] === value)) continue;
      forwarded = await fn(this.engine, input, async (e: unknown) => { forwarded = e; return result; });
    }
    return { result: forwarded, input };
  }
  async step(usage: any = { input_tokens: 2, output_tokens: 807, cache_read_input_tokens: 48952, cache_creation_input_tokens: 793, model: 'claude-haiku-5-5' }, agentId?: string) {
    const e = { turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 5, ...(agentId ? { agentId } : {}) };
    for (const { fn } of this.handlers.get('turn.step') ?? []) {
      const iterator = fn(this.engine, e, async function* (input: unknown) { yield { marker: input }; return { usage }; });
      while (!(await iterator.next()).done) { /* drain unchanged stream */ }
    }
  }
  async start() { await this.emit('session.start', { cwd: '.', surface: 'terminal', isInteractive: true }); }
  async stop(tasks: unknown = [{ id: 'a', type: 'subagent', status: 'running', description: 'Audit sk-test-123' }]) { return this.emit('classic.Stop', { background_tasks: tasks }); }
  async arm() { await this.start(); await this.step(); await this.stop(); }
  async advance(ms: number) {
    const target = this.now + ms;
    for (let i = 0; i < 1000; i++) {
      const t = this.timers.filter(t => t.active && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!t) break;
      this.now = t.at;
      if (t.interval) t.at += t.interval; else t.active = false;
      await t.fn(); await this.settle();
    }
    this.now = target; await this.settle();
  }
  async settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
  get pending() { return this.timers.filter(t => t.active && !t.interval); }
  rows() { return this.writes.length ? JSON.parse('[' + this.writes.at(-1)!.trim().split('\n').join(',') + ']') : []; }
  snapshot(id = this.id) { const prefix = `session:${encodeURIComponent(id)}:`; return [...this.values.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value).at(-1) as any; }
  async command(args: string) { return (await this.emit('command.run', { command: 'keepwarm', args })).result as { text: string }; }
}
