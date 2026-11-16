import type { PtcJsonValue } from '@deepseek-ai/dsh-ptc-runtime';
import { ScriptedRuntimeError, failure } from './ports.js';

/**
 * The program output the plugin consumes from the host's TypeScript runtime.
 *
 * The host contract moved from one text string per captured call to an ordered
 * list of text and image entries, and no published SDK declares that newer
 * shape yet. The plugin therefore owns the shape it reads: it accepts either
 * contract at runtime, prefers the ordered one, and refuses anything else by
 * name instead of letting an unclassified exception escape.
 */

/** One ordered entry: emitted text, or an image the program inspected. */
export type NativePtcOutput = { readonly type: 'text'; readonly text: string } | { readonly type: 'image'; readonly attachment: unknown };

/** The program result this plugin reads; every field is optional so either host vintage satisfies it. */
export interface NativePtcRunResult {
  /** Applied file policy and observed denial, when the provider enforces file policy. */
  readonly sandbox?: { readonly mode?: string; readonly denied: boolean; readonly enforcement?: string };
  readonly value?: PtcJsonValue;
  readonly error?: { readonly kind: string; readonly message: string };
  /** Current contract: text and inspected images in emission order. */
  readonly output?: readonly NativePtcOutput[];
  /** Earlier contract: one text string per captured call. */
  readonly logs?: readonly string[];
}

/** Which host contract produced one read. */
export type ProgramOutputContract = 'ordered' | 'earlier';

/** The bounded program output plus the contract it came from. */
export interface ProgramOutput {
  readonly text: string;
  readonly contract: ProgramOutputContract;
}

/** The bounded total one program's output may contribute to its diagnostics. */
export const PROGRAM_OUTPUT_MAX_BYTES = 64 * 1024;
/** How many observed keys and entry types a refusal quotes back. */
const OBSERVED_LIMIT = 12;
/** The longest shape summary one refusal message carries. */
const OBSERVED_MESSAGE_MAX = 400;
/** The token shape a host-provided key or entry type may reach a message as. */
const SAFE_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/;

function safeToken(value: string): string {
  return SAFE_TOKEN.test(value) ? value : 'unrecognized';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** One entry's kind, read defensively so a hostile value cannot break the refusal. */
function entryType(entry: unknown): string {
  try {
    const item = asRecord(entry);
    if (item === undefined) return Array.isArray(entry) ? 'array' : typeof entry;
    const type = item.type;
    if (typeof type === 'string') return safeToken(type);
    return type === undefined ? 'untyped' : typeof type;
  } catch { return 'unreadable'; }
}

/** The entry kinds one published list carries, bounded, for a refusal to quote. */
function entryTypes(entries: readonly unknown[]): string[] {
  return [...new Set(entries.slice(0, OBSERVED_LIMIT).map(entryType))];
}

/** The shape a host actually published, bounded and JSON-safe, so a refusal can name it. */
function observed(value: unknown): Record<string, unknown> {
  try {
    if (Array.isArray(value)) return { entries: entryTypes(value) };
    const record = asRecord(value);
    if (record === undefined) return { value: typeof value };
    const shape = (name: 'output' | 'logs'): unknown => {
      try { const field = record[name]; return Array.isArray(field) ? entryTypes(field) : typeof field; } catch { return 'unreadable'; }
    };
    return { keys: Object.keys(record).slice(0, OBSERVED_LIMIT).map(safeToken), output: shape('output'), logs: shape('logs') };
  } catch { return { value: 'unreadable' }; }
}

/** One marker standing in for the images a program inspected. */
function imageMarker(count: number): string {
  return '[' + count + (count === 1 ? ' image output omitted]' : ' images output omitted]');
}

/** One bounded, safe sentence naming the shape a host published. */
function describe(value: unknown): string {
  const shape = observed(value);
  const entries = shape.entries;
  if (Array.isArray(entries)) return (' entries: ' + entries.join(', ') + '.').slice(0, OBSERVED_MESSAGE_MAX);
  // A non-object or unreadable result has no keys: name the value's own type.
  if (typeof shape.value === 'string') return (' value: ' + shape.value + '.').slice(0, OBSERVED_MESSAGE_MAX);
  const parts = [
    'keys: ' + (((shape.keys as string[] | undefined) ?? []).join(', ') || 'none'),
    'output: ' + String(shape.output),
    'logs: ' + String(shape.logs),
  ];
  return (' ' + parts.join('; ') + '.').slice(0, OBSERVED_MESSAGE_MAX);
}

/**
 * Refuse one unreadable program result, naming the shape the host published.
 *
 * The message carries the bounded shape because it is the part a person reads on
 * the card and in History; the same facts are also kept as structured detail.
 */
function unsupported(value: unknown, detail: string): never {
  failure('TYPESCRIPT_RESULT_UNSUPPORTED', 'The TypeScript provider returned no readable program output: ' + detail + '.' + describe(value), observed(value));
}

function bounded(text: string, limit: number, contract: ProgramOutputContract): ProgramOutput {
  if (Buffer.byteLength(text) > limit) failure('OUTPUT_LIMIT', 'The TypeScript program output exceeded the bounded limit.');
  return { text, contract };
}

/** The ordered contract: adjacent text runs together, images are counted once. */
function ordered(entries: readonly unknown[], limit: number): ProgramOutput {
  const parts: string[] = [];
  let images = 0;
  for (const entry of entries) {
    const item = asRecord(entry);
    if (item?.type === 'text' && typeof item.text === 'string') { parts.push(item.text); continue; }
    if (item?.type === 'image') { images += 1; continue; }
    unsupported(entries, 'an ordered output entry is neither text nor an image');
  }
  const text = parts.join('');
  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n';
  const rendered = images === 0 ? text : text.length === 0 ? imageMarker(images) : text + separator + imageMarker(images);
  return bounded(rendered, limit, 'ordered');
}

/** The earlier contract: one line per captured call, its own historical shape. */
function earlier(logs: readonly unknown[], limit: number): ProgramOutput {
  if (logs.some(log => typeof log !== 'string')) unsupported(logs, 'a per-call log entry is not text');
  return bounded((logs as readonly string[]).join('\n'), limit, 'earlier');
}

function read(result: unknown, limit: number): ProgramOutput {
  const record = asRecord(result);
  if (record === undefined) unsupported(result, 'the result is not an object');
  if (Array.isArray(record.output)) return ordered(record.output, limit);
  if (Array.isArray(record.logs)) return earlier(record.logs, limit);
  unsupported(result, 'the result publishes neither ordered output nor a per-call log list');
}

/**
 * Read one program result's captured output.
 *
 * Accepts the ordered contract and the earlier per-call list; anything else, and
 * any failure raised while reading, settles as the same named refusal carrying
 * the shape the host published.
 */
export function programOutput(result: unknown, limit: number = PROGRAM_OUTPUT_MAX_BYTES): ProgramOutput {
  try {
    return read(result, limit);
  } catch (error) {
    if (error instanceof ScriptedRuntimeError) throw error;
    unsupported(result, 'the result could not be read: ' + (error instanceof Error ? error.message : String(error)));
  }
}
