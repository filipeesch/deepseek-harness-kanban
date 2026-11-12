import { deterministicDefinitionSchema, ENVIRONMENT_NAME, EXIT_NAME } from '../../domain/deterministic-definition.js';
import type { DeterministicDefinition } from '../../shared/deterministic.js';

export interface DeterministicDraft {
  language: 'bash' | 'typescript';
  source: 'inline' | 'file';
  code: string;
  file: string;
  directory: 'task' | 'project';
  env: string;
  exits: Array<{ name: string; to: string }>;
}
export function deterministicDraft(value?: DeterministicDefinition): DeterministicDraft {
  return { language: value?.language ?? 'bash', source: value?.file === undefined ? 'inline' : 'file', code: value?.code ?? '', file: value?.file ?? '', directory: value?.directory ?? 'task', env: (value?.env ?? []).join(', '), exits: Object.entries(value?.exits ?? {}).map(([name, to]) => ({ name, to })) };
}
export function deterministicDefinition(draft: DeterministicDraft): DeterministicDefinition {
  const env = draft.env.split(/[\s,]+/).filter(Boolean);
  return { language: draft.language, ...(draft.source === 'inline' ? { code: draft.code } : { file: draft.file }), directory: draft.directory, ...(env.length ? { env } : {}), exits: Object.fromEntries(draft.exits.map(route => [route.name, route.to])) };
}
export type DeterministicField = 'source' | 'env' | 'exits';
export function deterministicProblems(draft: DeterministicDraft, targets: ReadonlySet<string>): Array<{ field: DeterministicField; message: string }> {
  const problems: Array<{ field: DeterministicField; message: string }> = [];
  if (!(draft.source === 'inline' ? draft.code : draft.file).trim()) problems.push({ field: 'source', message: draft.source === 'inline' ? 'Inline code is required.' : 'A script file is required.' });
  const env = draft.env.split(/[\s,]+/).filter(Boolean);
  if (env.some(name => !ENVIRONMENT_NAME.test(name)) || new Set(env).size !== env.length) problems.push({ field: 'env', message: 'Use unique environment variable names, not values.' });
  if (!draft.exits.length) problems.push({ field: 'exits', message: 'Add at least one named exit.' });
  const names = draft.exits.map(route => route.name);
  if (names.some(name => !EXIT_NAME.test(name)) || new Set(names).size !== names.length) problems.push({ field: 'exits', message: 'Exit names must be unique safe identifiers.' });
  if (draft.exits.some(route => !targets.has(route.to))) problems.push({ field: 'exits', message: 'Each exit must target another existing stage.' });
  const parsed = deterministicDefinitionSchema.safeParse(deterministicDefinition(draft));
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field: DeterministicField = issue.path[0] === 'env' ? 'env' : issue.path[0] === 'exits' ? 'exits' : 'source';
    if (!problems.some(problem => problem.field === field)) problems.push({ field, message: issue.message });
  }
  return problems;
}
