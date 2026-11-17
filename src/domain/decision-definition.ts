import { z } from 'zod';
import type { DecisionDefinition, DecisionOption } from '../shared/types.js';
import { invariant } from '../shared/errors.js';
import { isDomainId } from './validation.js';
import { invalidWorkflow } from './yaml-fields.js';
import { TRANSITION_REASON_LIMIT } from './transition-reason.js';

/** The accepted bounds of one decision stage and the observation a person may add. */
export const DECISION_LIMITS = {
  options: 12,
  questionLength: 2_000,
  contextLength: 8_000,
  titleLength: 200,
  descriptionLength: 2_000,
  // A title (200), the two prefixes (24), and the observation must all fit the
  // 1,000-character destination reason, so an accepted observation is never cut.
  noteLength: 776,
} as const;

/** A decision option identity: a safe identifier no longer than the accepted length. */
export const DECISION_OPTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const nonempty = (limit: number, label: string) => z.string().min(1).max(limit, label + ' exceeds its accepted length.').refine(value => value.trim().length > 0, label + ' must be nonempty.');

/** One authored option; the declaration never carries a value. */
export const decisionOptionSchema = z.strictObject({
  id: z.string().regex(DECISION_OPTION_ID, 'An option id must be a safe identifier of at most 64 characters.'),
  title: nonempty(DECISION_LIMITS.titleLength, 'An option title'),
  description: nonempty(DECISION_LIMITS.descriptionLength, 'An option description').optional(),
  to: z.string().refine(isDomainId, 'An option destination must be a safe stage identifier.'),
});

/** One strict codec used by YAML, persisted workflows, patches, and journal events. */
export const decisionDefinitionSchema = z.strictObject({
  question: nonempty(DECISION_LIMITS.questionLength, 'A decision question'),
  context: z.string().max(DECISION_LIMITS.contextLength, 'A decision context exceeds its accepted length.').optional(),
  options: z.array(decisionOptionSchema)
    .min(1, 'A decision requires at least one option.')
    .max(DECISION_LIMITS.options, 'At most ' + DECISION_LIMITS.options + ' options are supported.')
    .refine(list => new Set(list.map(option => option.id)).size === list.length, 'Option ids must be unique within the stage.'),
});

function issues(error: z.ZodError): string {
  return error.issues.map(issue => issue.path.join('.') + ' ' + issue.message).join('; ');
}

/** Parse one authored decision configuration; a blank context is absence. */
export function parseDecisionDefinition(value: unknown): DecisionDefinition {
  const parsed = decisionDefinitionSchema.safeParse(value);
  if (!parsed.success) invalidWorkflow('Invalid decision definition: ' + issues(parsed.error));
  const context = parsed.data.context !== undefined && parsed.data.context.trim().length > 0 ? parsed.data.context : undefined;
  const definition: DecisionDefinition = { question: parsed.data.question, ...(context === undefined ? {} : { context }), options: parsed.data.options.map(option => ({ ...option })) };
  return definition;
}

/** Canonical comparison ignores mapping order, but never normalizes authored text or option order. */
export function canonicalDecision(value: DecisionDefinition | undefined): unknown {
  if (value === undefined) return undefined;
  return {
    question: value.question,
    context: value.context ?? null,
    options: value.options.map(option => ({ id: option.id, title: option.title, description: option.description ?? null, to: option.to })),
  };
}

export function decisionEqual(left: DecisionDefinition | undefined, right: DecisionDefinition | undefined): boolean {
  return JSON.stringify(canonicalDecision(left)) === JSON.stringify(canonicalDecision(right));
}

/** The destination stages one decision configuration references, in authored order. */
export function decisionDestinations(value: DecisionDefinition | undefined): string[] {
  return (value?.options ?? []).map(option => option.to);
}

/** The option a person chose, or undefined when the stage no longer authors it. */
export function decisionOption(value: DecisionDefinition | undefined, optionId: string): DecisionOption | undefined {
  return value?.options.find(option => option.id === optionId);
}
/** Trim one observation; an empty observation is absence, and an oversized one is refused. */
export function normalizeDecisionNote(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  invariant(typeof value === 'string', 'INVALID_INPUT', 'A decision observation must be text.');
  const note = value.trim();
  if (note.length === 0) return undefined;
  invariant(note.length <= DECISION_LIMITS.noteLength, 'DECISION_NOTE_TOO_LONG', 'A decision observation must be ' + DECISION_LIMITS.noteLength + ' characters or fewer.');
  return note;
}

/**
 * The reason a decision carries to its destination: the option title, then the
 * person's observation, then the authored description when the accepted reason
 * length still holds it. The option title is never truncated.
 */
export function composeDecisionReason(option: DecisionOption, note?: string): string {
  let reason = 'Decision: ' + option.title;
  // The authoring bound guarantees the whole observation fits; only the optional
  // description yields when the reason has no room left.
  if (note !== undefined) reason += '\nObservation: ' + note;
  if (option.description !== undefined) {
    const room = TRANSITION_REASON_LIMIT - reason.length - 1;
    if (room > 20) reason += '\n' + option.description.slice(0, room);
  }
  return reason;
}