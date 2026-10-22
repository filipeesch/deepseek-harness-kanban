import type { Problem } from './types.js';
export class KanbanError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: Record<string, unknown>) { super(message); this.name='KanbanError'; }
}
export function problem(error: unknown): Problem {
  if (error instanceof KanbanError) return { code:error.code, message:error.message, ...(error.details ? {details:error.details}: {}) };
  return {code:'KANBAN_ERROR',message:error instanceof Error ? error.message : String(error)};
}
export function invariant(value: unknown, code: string, message: string): asserts value { if(!value)throw new KanbanError(code,message); }
