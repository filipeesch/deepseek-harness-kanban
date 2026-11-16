import { bounded } from '../shared/bounded.js';
import type { FailureDetail, FailureOrigin } from '../shared/scripted-failure.js';
import type { StageEntryOrigin } from '../shared/task-history.js';

/** The accepted size of a message handed to a destination stage. */
export const FAILURE_MESSAGE_MAX_BYTES = 4 * 1024;
const STACK_LINE = /^\s+at\s/;
// A POSIX absolute path with at least one segment, not the "//" of a URL.
const POSIX_PATH = /(^|[\s("'=\[])(\/(?![\/])[^\s"'()[\]]+)/g;
const WINDOWS_PATH = /(^|[\s("'=\[])([A-Za-z]:\\[^\s"'()[\]]+)/g;
const UNC_PATH = /(^|[\s("'=\[])(\\\\[^\s"'()[\]]+)/g;

/**
 * A failure text a destination agent or a person can read: no stack frames and no
 * local filesystem path. The structured facts stay in the task record instead.
 */
export function sanitizeFailureText(text: string): string {
  const withoutStack = text.split('\n').filter(line => !STACK_LINE.test(line)).join('\n').trim();
  return withoutStack.replace(POSIX_PATH, '$1[path]').replace(WINDOWS_PATH, '$1[path]').replace(UNC_PATH, '$1[path]');
}

/**
 * Codes whose own message is product-owned and already names the facts a person
 * needs, so no provider sentence replaces it.
 */
const OWN_DIAGNOSIS = new Set(['TYPESCRIPT_RESULT_UNSUPPORTED']);

/** The controlled sentence for a provider or runtime failure whose text is not ours. */
const PROVIDER_MESSAGES: Readonly<Record<string, string>> = {
  EXECUTOR_FAILED: 'The execution provider failed before returning a result.',
  TYPESCRIPT_TIMEOUT: 'The TypeScript execution provider did not finish in time.',
  TYPESCRIPT_WORKER_EXIT: 'The TypeScript execution provider exited before returning a result.',
  TYPESCRIPT_PROTOCOL: 'The TypeScript execution provider returned an invalid result.',
  TYPESCRIPT_SANDBOX_UNAVAILABLE: 'The TypeScript execution provider could not establish the selected file policy.',
  TYPESCRIPT_ABORT: 'The TypeScript execution provider was stopped before returning a result.',
  OUTPUT_TRANSPORT_LIMIT: 'The guarded shell output exceeded the transport limit.',
};

/**
 * The public sentence for a provider failure, or undefined when the code's own
 * message is already product-owned. A provider's arbitrary text never becomes the
 * delivered message; it stays in the redacted detail.
 */
export function providerFailureMessage(code: string): string | undefined {
  if (OWN_DIAGNOSIS.has(code)) return undefined;
  if (Object.hasOwn(PROVIDER_MESSAGES, code)) return PROVIDER_MESSAGES[code];
  return code.startsWith('TYPESCRIPT_') && code !== 'TYPESCRIPT_EXCEPTION' ? 'The TypeScript execution provider failed before returning a result.' : undefined;
}

export interface FailureMessageInput {
  code: string;
  origin: FailureOrigin;
  /** The failure's own words, exactly as the producer reported them. */
  message: string;
  details?: FailureDetail;
  /** The sentence naming the step that owed a missing parameter value, when one is known. */
  debtor?: string;
}

/** The escalation guidance one origin adds after its own words. */
const OWNERS: Readonly<Record<FailureOrigin, string>> = {
  script: ' The program must be corrected by the user: escalate this problem to the user instead of working around it.',
  contract: ' The program must be corrected by the user: escalate this problem to the user instead of working around it.',
  configuration: '',
  infrastructure: ' This is a defect in the DeepSeek Harness or the Kanban plugin, not in the work: escalate it to the user so the application developers can address it.',
};
/** The configuration sentence for a code whose cause no stage or entry can repair. */
const CONFIGURATION_GUIDANCE: Readonly<Record<string, string>> = {
  TYPESCRIPT_RESULT_UNSUPPORTED: ' Update the DeepSeek Harness build that hosts this plugin, then press Play: escalate this problem to the user.',
};
/** The sentence a configuration failure the entry can repair carries. */
const REPAIR_GUIDANCE = ' Fix the stage or the entry, then press Play.';

/**
 * The sentence naming who owed one missing parameter value, from the origin of
 * the entry that lacked it. Absent for a record written before origins existed.
 */
export function parameterDebtor(origin?: StageEntryOrigin): string | undefined {
  if (origin === undefined) return undefined;
  if (origin === 'agent') return ' The transition into this stage was declared without it, so the agent that declared it must correct it.';
  if (origin === 'auto') return ' The automatic advance supplied no value, so the user must provide it.';
  if (origin === 'manual') return ' This entry was created by hand, so the user must provide it.';
  if (origin.startsWith('script:')) return ' The scripted result that delivered this entry did not supply it, so the program that produced it must correct it.';
  return ' The failure route created this entry without a value, so the user must provide it.';
}

/**
 * One settled failure as the sentence a destination stage receives. A program
 * failure keeps its own words; a host failure is summarized so a tool defect is
 * never mistaken for a problem in the work.
 */
export function failureMessage(input: FailureMessageInput): string {
  const attempts = input.details?.attempts?.length ?? 0;
  const count = attempts === 0 ? '' : ' (' + attempts + (attempts === 1 ? ' attempt' : ' attempts') + ')';
  let rendered: string;
  switch (input.origin) {
    case 'script': rendered = input.message + OWNERS.script; break;
    case 'contract': rendered = 'The script completion was rejected: ' + sanitizeFailureText(input.message) + OWNERS.contract; break;
    case 'configuration': rendered = 'Configuration failure: ' + sanitizeFailureText(input.message) + (CONFIGURATION_GUIDANCE[input.code] ?? REPAIR_GUIDANCE) + (input.debtor ?? ''); break;
    case 'infrastructure': rendered = 'Infrastructure failure: ' + sanitizeFailureText(input.message) + count + ' Detail: the task History.' + OWNERS.infrastructure; break;
  }
  return bounded(rendered, FAILURE_MESSAGE_MAX_BYTES);
}
