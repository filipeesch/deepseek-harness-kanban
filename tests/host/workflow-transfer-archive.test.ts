import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { TRANSFER_FORMAT, TRANSFER_MAX_PAYLOAD_BYTES, TRANSFER_VERSION, type TransferDocument } from '../../src/domain/workflow-transfer/document.js';
import { decodeTransferDocument, encodeTransferDocument, describeSize, suggestedFileName, assertAcceptedSize } from '../../src/host/workflow-transfer/archive.js';

const workflow = ['name: Delivery', 'columns:', '  - id: todo', '    label: To do', ''].join(String.fromCharCode(10));

function document(overrides: Partial<TransferDocument> = {}): TransferDocument {
  return {
    format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Team Hub' },
    boards: [{ name: 'Delivery', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }],
    ...overrides,
  };
}

function refusalOf(run: () => unknown): { code: string; message: string } {
  try { run(); } catch (error) { return error as { code: string; message: string }; }
  throw new Error('Expected a refusal.');
}

describe('transfer archive', () => {
  it('round-trips a document', () => {
    const bytes = encodeTransferDocument(document());
    const parsed = decodeTransferDocument(bytes);
    expect(parsed.origin.hubName).toBe('Team Hub');
    expect(parsed.boards[0]!.workflowYaml).toBe(workflow);
  });

  it('compresses the payload rather than storing it', () => {
    const repeated = Array.from({ length: 200 }, () => '    label: Repeated stage name').join(String.fromCharCode(10));
    const bytes = encodeTransferDocument(document({ boards: [{ name: 'Delivery', workflowYaml: ['columns:', '  - id: todo', repeated, ''].join(String.fromCharCode(10)), presetMode: null, projectKeys: null, stageIdentities: null }] }));
    expect(bytes.byteLength).toBeLessThan(Buffer.byteLength(serializeLength(repeated), 'utf8'));
  });

  it('produces identical bytes for the same document twice', () => {
    expect(encodeTransferDocument(document()).equals(encodeTransferDocument(document()))).toBe(true);
  });

  it('refuses a file that is not gzip-compressed', () => {
    const refusal = refusalOf(() => decodeTransferDocument(Buffer.from('{"format":"dsh-kanban-workflows"}', 'utf8')));
    expect(refusal.code).toBe('TRANSFER_NOT_COMPRESSED');
  });

  it('refuses gzip content that is not JSON', () => {
    const refusal = refusalOf(() => decodeTransferDocument(gzipSync(Buffer.from('not json', 'utf8'))));
    expect(refusal.code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusal.message).toContain('JSON');
  });

  it('refuses an empty file', () => {
    expect(refusalOf(() => decodeTransferDocument(Buffer.alloc(0))).code).toBe('TRANSFER_INVALID_DOCUMENT');
  });

  it('refuses a file above the compressed limit before reading it', () => {
    const refusal = refusalOf(() => assertAcceptedSize(5 * 1024 * 1024));
    expect(refusal.code).toBe('TRANSFER_TOO_LARGE');
    expect(refusal.message).toContain('4.0 MB');
  });

  it('refuses a payload that expands past the bound', () => {
    const huge = JSON.stringify({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Huge' }, boards: [{ name: 'Big', workflowYaml: 'x'.repeat(TRANSFER_MAX_PAYLOAD_BYTES), presetMode: null, projectKeys: null, stageIdentities: null }] });
    let refusal: { code: string; message: string } | undefined;
    try { decodeTransferDocument(gzipSync(Buffer.from(huge, 'utf8'))); }
    catch (error) { refusal = error as { code: string; message: string }; }
    expect(refusal?.code).toBe('TRANSFER_TOO_LARGE');
  });

  it('describes a byte count the way a person reads it', () => {
    expect(describeSize(512)).toBe('512 bytes');
    expect(describeSize(2048)).toBe('2.0 KB');
    expect(describeSize(4 * 1024 * 1024)).toBe('4.0 MB');
  });

  it('suggests a file name naming the Hub and the date only', () => {
    expect(suggestedFileName('Team Hub', new Date('2026-11-20T10:00:00.000Z'))).toBe('kanban-workflows-team-hub-2026-11-20.json.gz');
    expect(suggestedFileName('  ***  ', new Date('2026-11-20T10:00:00.000Z'))).toBe('kanban-workflows-hub-2026-11-20.json.gz');
  });
});

function serializeLength(repeated: string): string {
  return ['columns:', '  - id: todo', repeated, ''].join(String.fromCharCode(10));
}
