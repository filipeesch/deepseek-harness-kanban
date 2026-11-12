import { createHash } from 'node:crypto';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { sequenceItemText } from './journal/authored-text.js';
import { authoredScalar } from './yaml-map-fields.js';
import { KanbanError, invariant } from '../shared/errors.js';

/** What one stage's authored block says about its script source. */
export interface StageSource {
  readonly kind: 'inline' | 'file';
  /** Digest of the inline source bytes; absent for an external file. */
  readonly digest?: string;
  readonly bytes?: number;
  /** The authored external path; absent for inline source. */
  readonly file?: string;
}

/** One stage as the agent reads it: its authored block, and its source declaration. */
export interface StageRead {
  readonly stageId: string;
  readonly text: string;
  readonly source?: StageSource;
}

/** The authored block of one stage, with its inline script source withheld unless asked for. */
export function readStage(input: { readonly text: string; readonly stageId: string; readonly includeSource: boolean }): StageRead {
  const block = sequenceItemText({ text: input.text, sequenceKey: 'columns', fields: { id: input.stageId } });
  invariant(block !== undefined, 'STAGE_NOT_FOUND', 'The workflow has no stage ' + input.stageId + '.');
  let document;
  try { document = parseDocument(block, { uniqueKeys: true, prettyErrors: false, version: '1.2' }); }
  catch (error) { throw new KanbanError('INVALID_WORKFLOW', 'The stage block could not be read: ' + (error instanceof Error ? error.message : String(error))); }
  // A block sequence parses as a one-entry list; a flow-style column parses as
  // the mapping itself, and either shape must be read before the source is withheld.
  const contents = document.contents as unknown;
  const item = isSeq(contents) ? contents.items[0] : contents;
  const deterministic = isMap(item) ? item.get('deterministic', true) : undefined;
  const codeNode = isMap(deterministic) ? deterministic.get('code', true) : undefined;
  const fileNode = isMap(deterministic) ? deterministic.get('file', true) : undefined;
  if (!isScalar(codeNode) && !isScalar(fileNode)) return { stageId: input.stageId, text: block };
  if (isScalar(fileNode) && typeof fileNode.value === 'string') {
    // The external path is the authored declaration, not the source bytes.
    return { stageId: input.stageId, text: block, source: { kind: 'file', file: fileNode.value } };
  }
  if (!isScalar(codeNode)) return { stageId: input.stageId, text: block };
  const source = String(codeNode.value);
  const bytes = Buffer.byteLength(source, 'utf8');
  const digest = 'sha256:' + createHash('sha256').update(source, 'utf8').digest('hex');
  if (input.includeSource) return { stageId: input.stageId, text: block, source: { kind: 'inline', digest, bytes } };
  const range = codeNode.range as [number, number, number] | null | undefined;
  if (range === null || range === undefined) return { stageId: input.stageId, text: block, source: { kind: 'inline', digest, bytes } };
  const withheld = authoredScalar('<source withheld ' + digest + ', ' + bytes + ' bytes>');
  return { stageId: input.stageId, text: block.slice(0, range[0]) + withheld + block.slice(range[1]), source: { kind: 'inline', digest, bytes } };
}
