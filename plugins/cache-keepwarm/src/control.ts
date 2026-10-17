export type ControlAction = 'on' | 'off' | 'status' | 'invalid';
export function parseControl(_args: string): ControlAction { throw new Error('not built'); }
export function effectiveEnabled(_launch: boolean, _override: boolean | null): boolean { throw new Error('not built'); }
