import { z } from 'zod';
import type { DeterministicDefinition } from '../shared/deterministic.js';
import { isDomainId } from './validation.js';
import { invalidWorkflow } from './yaml-fields.js';

export const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const EXIT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** One strict codec used by YAML, persisted workflows, patches, and journal events. */
export const deterministicDefinitionSchema = z.strictObject({
  language: z.enum(['bash', 'typescript']),
  code: z.string().refine(value => value.trim().length > 0, 'Code must be nonempty.').optional(),
  file: z.string().refine(value => value.trim().length > 0 && !value.includes('\0'), 'File must be a nonempty path.').optional(),
  directory: z.enum(['task', 'project']).default('task'),
  env: z.array(z.string().regex(ENVIRONMENT_NAME)).refine(names => new Set(names).size === names.length, 'Environment names must be unique.').optional(),
  exits: z.record(z.string().regex(EXIT_NAME).refine(isDomainId), z.string().refine(isDomainId)).refine(value => Object.keys(value).length > 0, 'At least one named exit is required.'),
}).superRefine((value, context) => {
  if ((value.code !== undefined) === (value.file !== undefined)) context.addIssue({ code: 'custom', path: ['code'], message: 'Exactly one of code or file is required.' });
});
export function parseDeterministicDefinition(value: unknown): DeterministicDefinition {
  const parsed = deterministicDefinitionSchema.safeParse(value);
  if (!parsed.success) invalidWorkflow('Invalid deterministic definition: ' + parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; '));
  return parsed.data;
}
/** Canonical comparison ignores mapping order, but never normalizes program bytes. */
export function canonicalDeterministic(value: DeterministicDefinition | undefined): unknown {
  if (value === undefined) return undefined;
  return { language: value.language, code: value.code, file: value.file, directory: value.directory ?? 'task', env: [...(value.env ?? [])].sort(), exits: Object.fromEntries(Object.entries(value.exits).sort(([a], [b]) => a.localeCompare(b))) };
}
export function deterministicEqual(left: DeterministicDefinition | undefined, right: DeterministicDefinition | undefined): boolean {
  return JSON.stringify(canonicalDeterministic(left)) === JSON.stringify(canonicalDeterministic(right));
}
