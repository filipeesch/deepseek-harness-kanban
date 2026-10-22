import type { QuestionAnswer, QuestionPage, QuestionRound } from '../shared/types.js';
import { KanbanError } from '../shared/errors.js';

/** An answer marker that cannot be confused with an agent-provided option title. */
export const OTHER_CHOICE = '__kanban_other__';
export type QuestionAnswers = Readonly<Record<string, QuestionAnswer>> | ReadonlyMap<string, QuestionAnswer>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function invalid(message: string): never { throw new KanbanError('INVALID_QUESTION_PAGE', message); }
function optionalString(source: Record<string, unknown>, name: string): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(name + ' must be a string.');
  return value;
}

/** Validate tool-owned semantics rather than relying on unsupported JSON Schema keywords. */
export function validateQuestionPage(value: unknown): QuestionPage {
  if (!record(value)) invalid('A question page must be an object.');
  if (typeof value.question !== 'string' || !value.question.trim()) invalid('Question text is required.');
  if (value.type !== 'exclusive' && value.type !== 'non_exclusive' && value.type !== 'freetext') invalid('Unknown question type.');
  const page: QuestionPage = { question: value.question.trim(), type: value.type };
  const context = optionalString(value, 'context');
  const lean = optionalString(value, 'model_lean');
  const reason = optionalString(value, 'model_lean_reason');
  if (context !== undefined) page.context = context;
  if (reason !== undefined) page.model_lean_reason = reason;
  if (value.weight !== undefined) {
    if (value.weight !== 'critical' && value.weight !== 'medium' && value.weight !== 'easy') invalid('Unknown question weight.');
    page.weight = value.weight;
  }
  if (value.answers_affect_followup !== undefined) {
    if (typeof value.answers_affect_followup !== 'boolean') invalid('answers_affect_followup must be a boolean.');
    page.answers_affect_followup = value.answers_affect_followup;
  }
  if (page.type === 'freetext') {
    if (value.options !== undefined && (!Array.isArray(value.options) || value.options.length > 0)) invalid('Free-text questions cannot have choices.');
    if (lean !== undefined) invalid('A recommendation must name a supplied choice.');
  } else {
    if (!Array.isArray(value.options) || value.options.length < 2) invalid('Choice questions require at least two options.');
    const titles = new Set<string>();
    page.options = value.options.map((option: unknown) => {
      if (!record(option) || typeof option.title !== 'string' || !option.title.trim() || typeof option.description !== 'string') invalid('Every option requires a title and Markdown description.');
      const title = option.title.trim();
      if (title === OTHER_CHOICE || titles.has(title)) invalid('Option titles must be distinct and cannot use the reserved answer marker.');
      titles.add(title);
      return { title, description: option.description };
    });
    if (lean !== undefined) {
      if (!titles.has(lean)) invalid('The recommendation must exactly match an option title.');
      page.model_lean = lean;
    }
  }
  return page;
}

export function emptyAnswer(): QuestionAnswer { return { choices: [], text: '', other: '', notes: '' }; }

export function answerFor(answers: QuestionAnswers, callId: string): QuestionAnswer | undefined {
  if (answers instanceof Map) return answers.get(callId);
  return Object.hasOwn(answers, callId) ? (answers as Readonly<Record<string, QuestionAnswer>>)[callId] : undefined;
}

export function isAnswerValid(page: QuestionPage, answer: QuestionAnswer | undefined): boolean {
  if (!answer || !Array.isArray(answer.choices) || typeof answer.text !== 'string' || typeof answer.other !== 'string' || typeof answer.notes !== 'string') return false;
  if (page.type === 'freetext') return answer.text.trim().length > 0;
  const allowed = new Set([...(page.options ?? []).map(option => option.title), OTHER_CHOICE]);
  if (!answer.choices.length || new Set(answer.choices).size !== answer.choices.length || answer.choices.some(choice => !allowed.has(choice))) return false;
  if (page.type === 'exclusive' && answer.choices.length !== 1) return false;
  return !answer.choices.includes(OTHER_CHOICE) || answer.other.trim().length > 0;
}

/** Format exactly one ordinary user message. No decision records or native interaction replies. */
export function formatAnswers(round: QuestionRound, answers: QuestionAnswers, generalNotes = ''): string {
  if (!round.complete || round.answered || !round.pages.length) throw new KanbanError('QUESTION_ROUND_NOT_READY', 'The question round is not ready for submission.');
  const sections = round.pages.map(({ callId, page }, index) => {
    const validated = validateQuestionPage(page);
    const answer = answerFor(answers, callId);
    if (!isAnswerValid(validated, answer)) throw new KanbanError('INCOMPLETE_QUESTION_ANSWERS', 'Every question requires a valid answer.');
    const result: string[] = ['### ' + (index + 1) + '. ' + validated.question];
    if (validated.type === 'freetext') result.push('Answer: ' + answer!.text.trim());
    else {
      const selected = answer!.choices.filter(choice => choice !== OTHER_CHOICE);
      if (selected.length) result.push('Answer: ' + selected.join('; '));
      if (answer!.choices.includes(OTHER_CHOICE)) result.push('Other: ' + answer!.other.trim());
    }
    if (answer!.notes.trim()) result.push('Notes: ' + answer!.notes.trim());
    return result.join('\n\n');
  });
  if (generalNotes.trim()) sections.push('## Additional context\n\n' + generalNotes.trim());
  return sections.join('\n\n');
}
