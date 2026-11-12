import { deterministicDefinitionSchema, ENVIRONMENT_NAME, EXIT_NAME, PARAMETER_LIMITS, PARAMETER_NAME } from '../../domain/deterministic-definition.js';
import type { DeterministicDefinition } from '../../shared/deterministic.js';

/** One parameter row being authored; the description is optional guidance, never a value. */
export interface DeterministicParameterDraft { name: string; description: string }
export interface DeterministicDraft {
  language: 'bash' | 'typescript';
  source: 'inline' | 'file';
  code: string;
  file: string;
  directory: 'task' | 'project';
  env: string;
  params: DeterministicParameterDraft[];
  exits: Array<{ name: string; to: string }>;
}
export function deterministicDraft(value?: DeterministicDefinition): DeterministicDraft {
  return { language: value?.language ?? 'bash', source: value?.file === undefined ? 'inline' : 'file', code: value?.code ?? '', file: value?.file ?? '', directory: value?.directory ?? 'task', env: (value?.env ?? []).join(', '),
    params: (value?.params ?? []).map(parameter => ({ name: parameter.name, description: parameter.description ?? '' })),
    exits: Object.entries(value?.exits ?? {}).map(([name, to]) => ({ name, to })) };
}
export function deterministicDefinition(draft: DeterministicDraft): DeterministicDefinition {
  const env = draft.env.split(/[\s,]+/).filter(Boolean);
  const params = draft.params.map(parameter => ({ name: parameter.name.trim(), ...(parameter.description.trim() ? { description: parameter.description.trim() } : {}) }));
  return { language: draft.language, ...(draft.source === 'inline' ? { code: draft.code } : { file: draft.file }), directory: draft.directory, ...(env.length ? { env } : {}), ...(params.length ? { params } : {}), exits: Object.fromEntries(draft.exits.map(route => [route.name, route.to])) };
}
/** The authored guidance the exits editor shows; one place so the contract is testable. */
export const EXIT_HELP = 'Different exit names may share a destination. The reserved error and infrastructure exits receive synthesized failures: error for a script failure or a rejected completion, infrastructure for a failed guard or runtime, falling back to error when infrastructure is not mapped. No first-exit default is used.';

export type DeterministicField = 'source' | 'env' | 'params' | 'exits';
export function deterministicProblems(draft: DeterministicDraft, targets: ReadonlySet<string>): Array<{ field: DeterministicField; message: string }> {
  const problems: Array<{ field: DeterministicField; message: string }> = [];
  if (!(draft.source === 'inline' ? draft.code : draft.file).trim()) problems.push({ field: 'source', message: draft.source === 'inline' ? 'Inline code is required.' : 'A script file is required.' });
  const env = draft.env.split(/[\s,]+/).filter(Boolean);
  if (env.some(name => !ENVIRONMENT_NAME.test(name)) || new Set(env).size !== env.length) problems.push({ field: 'env', message: 'Use unique environment variable names, not values.' });
  if (draft.params.length > PARAMETER_LIMITS.count) problems.push({ field: 'params', message: 'At most ' + PARAMETER_LIMITS.count + ' parameters are supported.' });
  else if (draft.params.some(parameter => !parameter.name.trim())) problems.push({ field: 'params', message: 'A parameter name is required.' });
  else if (draft.params.some(parameter => !PARAMETER_NAME.test(parameter.name.trim()))) problems.push({ field: 'params', message: 'A parameter name must be a safe identifier of at most 64 characters.' });
  else if (new Set(draft.params.map(parameter => parameter.name.trim())).size !== draft.params.length) problems.push({ field: 'params', message: 'Parameter names must be unique.' });
  else if (draft.params.some(parameter => parameter.description.trim().length > PARAMETER_LIMITS.descriptionLength)) problems.push({ field: 'params', message: 'A parameter description exceeds its accepted length.' });
  if (!draft.exits.length) problems.push({ field: 'exits', message: 'Add at least one named exit.' });
  const names = draft.exits.map(route => route.name);
  if (names.some(name => !EXIT_NAME.test(name)) || new Set(names).size !== names.length) problems.push({ field: 'exits', message: 'Exit names must be unique safe identifiers.' });
  if (draft.exits.some(route => !targets.has(route.to))) problems.push({ field: 'exits', message: 'Each exit must target another existing stage.' });
  const parsed = deterministicDefinitionSchema.safeParse(deterministicDefinition(draft));
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field: DeterministicField = issue.path[0] === 'env' ? 'env' : issue.path[0] === 'exits' ? 'exits' : issue.path[0] === 'params' ? 'params' : 'source';
    if (!problems.some(problem => problem.field === field)) problems.push({ field, message: issue.message });
  }
  return problems;
}
