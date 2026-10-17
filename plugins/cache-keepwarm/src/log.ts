import type { Ttl, TtlSource } from './ttl.ts';
import type { BudgetLedger, SessionLedger, Usage } from './budget.ts';
export interface LogRow { at: number; event: string; epoch: number; items: readonly { id: string; kind: string }[]; ttl: Ttl; ttlSource: TtlSource; context: number | null; usage?: Usage; spent: number; reason?: string; warms?: number; ledger?: BudgetLedger; session?: SessionLedger }
export function appendLog(_rows: readonly LogRow[], _row: LogRow): LogRow[] { throw new Error('not built'); }
