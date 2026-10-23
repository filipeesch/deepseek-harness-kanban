import { parseDocument } from 'yaml';
import { parseWorkflow } from '../domain/workflow.js';
import type { Workflow } from '../shared/types.js';

export interface WorkflowIssue {
  code: string;
  message: string;
  /** Offsets are UTF-16 document offsets, matching the editor's positions. */
  from?: number;
  to?: number;
}

export interface WorkflowDiagnostic {
  from: number;
  to: number;
  severity: 'error';
  message: string;
}

export interface WorkflowAnalysis {
  status: 'valid' | 'invalid';
  workflow?: Workflow;
  issues: WorkflowIssue[];
  diagnostics: WorkflowDiagnostic[];
}

function lineStart(text: string, line: number): number {
  if (line <= 1) return 0;
  let current = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      current += 1;
      if (current === line) return index + 1;
    }
  }
  return text.length;
}

function offsetFor(text: string, value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const linePos = (value as { linePos?: unknown }).linePos;
  if (Array.isArray(linePos) && linePos[0] && typeof linePos[0] === 'object') {
    const line = (linePos[0] as { line?: unknown }).line;
    const col = (linePos[0] as { col?: unknown }).col;
    if (typeof line === 'number' && typeof col === 'number') return Math.min(text.length, lineStart(text, line) + Math.max(0, col - 1));
  }
  const pos = (value as { pos?: unknown }).pos;
  if (Array.isArray(pos) && typeof pos[0] === 'number') return Math.min(text.length, Math.max(0, pos[0]));
  return 0;
}

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') return (error as { code: string }).code;
  return 'INVALID_WORKFLOW';
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'The workflow is not valid.';
}

/** Analyze workflow YAML locally with the same schema the host trusts. */
export function analyzeWorkflow(yaml: string): WorkflowAnalysis {
  const text = typeof yaml === 'string' ? yaml : '';
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
  } catch (error) {
    const from = 0;
    return {
      status: 'invalid',
      issues: [{ code: codeOf(error), message: messageOf(error), from, to: Math.min(text.length, 1) }],
      diagnostics: [{ from, to: Math.max(from, Math.min(text.length, from + 1)), severity: 'error', message: messageOf(error) }],
    };
  }
  if (document.errors.length > 0) {
    const issues = document.errors.map(error => {
      const from = offsetFor(text, error);
      return { code: 'YAML_SYNTAX', message: messageOf(error), from, to: Math.min(text.length, from + 1) };
    });
    return {
      status: 'invalid',
      issues,
      diagnostics: issues.map(issue => ({ from: issue.from ?? 0, to: issue.to ?? 0, severity: 'error' as const, message: issue.message })),
    };
  }
  try {
    const workflow = parseWorkflow(text);
    return { status: 'valid', workflow, issues: [], diagnostics: [] };
  } catch (error) {
    const issue: WorkflowIssue = { code: codeOf(error), message: messageOf(error), from: 0, to: Math.min(text.length, 1) };
    return {
      status: 'invalid',
      issues: [issue],
      diagnostics: [{ from: 0, to: Math.max(0, Math.min(text.length, 1)), severity: 'error', message: issue.message }],
    };
  }
}
