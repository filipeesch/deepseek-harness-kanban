import { bounded } from '../shared/bounded.js';
import type { FailureDetail, FailureOrigin } from '../shared/deterministic-failure.js';

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
  if (Object.hasOwn(PROVIDER_MESSAGES, code)) return PROVIDER_MESSAGES[code];
  return code.startsWith('TYPESCRIPT_') && code !== 'TYPESCRIPT_EXCEPTION' ? 'The TypeScript execution provider failed before returning a result.' : undefined;
}

export interface FailureMessageInput {
  code: string;
  origin: FailureOrigin;
  /** The failure's own words, exactly as the producer reported them. */
  message: string;
  details?: FailureDetail;
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
    case 'script': rendered = input.message; break;
    case 'contract': rendered = 'The script completion was rejected: ' + sanitizeFailureText(input.message); break;
    case 'configuration': rendered = 'Configuration failure: ' + sanitizeFailureText(input.message) + ' Fix the stage or the entry, then press Play.'; break;
    case 'infrastructure': rendered = 'Infrastructure failure: ' + sanitizeFailureText(input.message) + count + ' Detail: the task History.'; break;
  }
  return bounded(rendered, FAILURE_MESSAGE_MAX_BYTES);
}
