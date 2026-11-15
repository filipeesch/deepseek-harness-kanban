import { z } from 'zod';
import type { ScriptedDefinition } from '../shared/scripted.js';
import { isDomainId } from './validation.js';
import { invalidWorkflow } from './yaml-fields.js';

export const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const EXIT_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** The accepted bounds of one parameter declaration and one value set. */
export const PARAMETER_LIMITS = { count: 32, nameLength: 64, descriptionLength: 200, valueLength: 4096, totalBytes: 32 * 1024 } as const;
/** A declared parameter name: a safe identifier no longer than the accepted length. */
export const PARAMETER_NAME = new RegExp('^[A-Za-z_][A-Za-z0-9_]{0,' + (PARAMETER_LIMITS.nameLength - 1) + '}$');
/** One required parameter; the declaration never carries a value. */
export const scriptedParameterSchema = z.strictObject({
  name: z.string().regex(PARAMETER_NAME, 'A parameter name must be a safe identifier of at most 64 characters.'),
  description: z.string().min(1).max(PARAMETER_LIMITS.descriptionLength, 'A parameter description exceeds its accepted length.').refine(value => value.trim().length > 0, 'A parameter description must be nonempty.').optional(),
});
/** One strict codec used by YAML, persisted workflows, patches, and journal events. */
export const scriptedDefinitionSchema = z.strictObject({
  language: z.enum(['bash', 'typescript']),
  code: z.string().refine(value => value.trim().length > 0, 'Code must be nonempty.').optional(),
  file: z.string().refine(value => value.trim().length > 0 && !value.includes('\0'), 'File must be a nonempty path.').optional(),
  directory: z.enum(['task', 'project']).default('task'),
  env: z.array(z.string().regex(ENVIRONMENT_NAME)).refine(names => new Set(names).size === names.length, 'Environment names must be unique.').optional(),
  params: z.array(scriptedParameterSchema)
    .max(PARAMETER_LIMITS.count, 'At most ' + PARAMETER_LIMITS.count + ' parameters are supported.')
    .refine(list => new Set(list.map(parameter => parameter.name)).size === list.length, 'Parameter names must be unique.')
    .optional(),
  exits: z.record(z.string().regex(EXIT_NAME).refine(isDomainId), z.string().refine(isDomainId)).refine(value => Object.keys(value).length > 0, 'At least one named exit is required.'),
}).superRefine((value, context) => {
  if ((value.code !== undefined) === (value.file !== undefined)) context.addIssue({ code: 'custom', path: ['code'], message: 'Exactly one of code or file is required.' });
});
export function parseScriptedDefinition(value: unknown): ScriptedDefinition {
  const parsed = scriptedDefinitionSchema.safeParse(value);
  if (!parsed.success) invalidWorkflow('Invalid scripted definition: ' + parsed.error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; '));
  const definition: ScriptedDefinition = { ...parsed.data };
  // An empty declaration is absence: the editor omits it and no entry needs a value.
  if (definition.params !== undefined && definition.params.length === 0) delete definition.params;
  return definition;
}
/** Canonical comparison ignores mapping order, but never normalizes program bytes or the parameter order. */
export function canonicalScripted(value: ScriptedDefinition | undefined): unknown {
  if (value === undefined) return undefined;
  return { language: value.language, code: value.code, file: value.file, directory: value.directory ?? 'task', env: [...(value.env ?? [])].sort(),
    params: (value.params ?? []).map(parameter => ({ name: parameter.name, description: parameter.description ?? null })),
    exits: Object.fromEntries(Object.entries(value.exits).sort(([a], [b]) => a.localeCompare(b))) };
}
export function scriptedEqual(left: ScriptedDefinition | undefined, right: ScriptedDefinition | undefined): boolean {
  return JSON.stringify(canonicalScripted(left)) === JSON.stringify(canonicalScripted(right));
}
