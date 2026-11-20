import { describe, expect, it } from 'vitest';
import {
  TRANSFER_FORMAT, TRANSFER_VERSION, TRANSFER_MAX_COMPRESSED_BYTES, TRANSFER_MAX_PAYLOAD_BYTES,
  parseTransferDocument, serializeTransferDocument, transferBoard,
} from '../../src/domain/workflow-transfer/document.js';

const workflow = ['name: Delivery', 'columns:', '  - id: todo', '    label: To do', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));

function exportPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Team Hub' }, boards: [{ name: 'Delivery', workflowYaml: workflow, presetMode: 'operator', projectKeys: null, stageIdentities: null }], ...overrides };
}

function refusalOf(run: () => unknown): { code: string; message: string; details?: Record<string, unknown> } {
  try { run(); } catch (error) { return error as { code: string; message: string; details?: Record<string, unknown> }; }
  throw new Error('Expected a refusal.');
}

describe('transfer document format', () => {
  it('states its version, bounds, and marker', () => {
    expect(TRANSFER_FORMAT).toBe('dsh-kanban-workflows');
    expect(TRANSFER_VERSION).toBe(1);
    expect(TRANSFER_MAX_COMPRESSED_BYTES).toBe(4 * 1024 * 1024);
    expect(TRANSFER_MAX_PAYLOAD_BYTES).toBeGreaterThan(TRANSFER_MAX_COMPRESSED_BYTES);
  });

  it('reads a valid document', () => {
    const parsed = parseTransferDocument(exportPayload());
    expect(parsed.format).toBe(TRANSFER_FORMAT);
    expect(parsed.origin.hubName).toBe('Team Hub');
    expect(parsed.boards).toHaveLength(1);
    expect(parsed.boards[0]!.workflowYaml).toBe(workflow);
    expect(parsed.boards[0]!.presetMode).toBe('operator');
  });

  it('refuses a payload that is not an export', () => {
    expect(refusalOf(() => parseTransferDocument(null)).code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusalOf(() => parseTransferDocument([1, 2])).code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusalOf(() => parseTransferDocument(exportPayload({ format: 'something-else' }))).code).toBe('TRANSFER_INVALID_DOCUMENT');
  });

  it('refuses a document without a readable version', () => {
    expect(refusalOf(() => parseTransferDocument(exportPayload({ version: 'one' }))).code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusalOf(() => parseTransferDocument(exportPayload({ version: 0 }))).code).toBe('TRANSFER_INVALID_DOCUMENT');
  });

  it('refuses a version newer than this installation reads, naming both versions', () => {
    const refusal = refusalOf(() => parseTransferDocument(exportPayload({ version: TRANSFER_VERSION + 1 })));
    expect(refusal.code).toBe('TRANSFER_UNSUPPORTED_VERSION');
    expect(refusal.message).toContain(String(TRANSFER_VERSION + 1));
    expect(refusal.message).toContain(String(TRANSFER_VERSION));
    expect(refusal.details).toEqual({ version: TRANSFER_VERSION + 1, supported: TRANSFER_VERSION });
  });

  it('refuses a document that fails its schema', () => {
    const refusal = refusalOf(() => parseTransferDocument(exportPayload({ boards: [{ name: '   ', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }] })));
    expect(refusal.code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusal.message).toContain('boards.0.name');
  });

  it('refuses an empty board list', () => {
    expect(refusalOf(() => parseTransferDocument(exportPayload({ boards: [] }))).code).toBe('TRANSFER_EMPTY');
  });

  it('refuses two boards under the same name', () => {
    const entry = { name: 'Delivery', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null };
    const refusal = refusalOf(() => parseTransferDocument(exportPayload({ boards: [entry, { ...entry, name: ' delivery ' }] })));
    expect(refusal.code).toBe('TRANSFER_INVALID_DOCUMENT');
    expect(refusal.message).toContain('unique');
  });
});

describe('transfer document serialization', () => {
  it('produces identical bytes for the same input twice', () => {
    const parsed = parseTransferDocument(exportPayload());
    expect(serializeTransferDocument(parsed)).toBe(serializeTransferDocument(parsed));
  });

  it('follows the order of the boards it is given', () => {
    const first = parseTransferDocument(exportPayload());
    const second = parseTransferDocument(exportPayload({ boards: [{ name: 'Second', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }, first.boards[0]] }));
    const text = serializeTransferDocument(second);
    expect(text.indexOf('Second')).toBeLessThan(text.indexOf('Delivery'));
  });

  it('writes stage identities in a stable order', () => {
    const entry = transferBoard({ name: 'Delivery', workflowYaml: workflow, stageIdentities: { zeta: 'identity-z', alpha: 'identity-a' } });
    const document = { format: TRANSFER_FORMAT as typeof TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Hub' }, boards: [entry] };
    const text = serializeTransferDocument(document);
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'));
    expect(parseTransferDocument(JSON.parse(text)).boards[0]!.stageIdentities).toEqual({ alpha: 'identity-a', zeta: 'identity-z' });
  });

  it('round-trips every carried field', () => {
    const entry = transferBoard({ name: 'Delivery', workflowYaml: workflow, presetMode: 'host', projectKeys: ['api', 'web'], stageIdentities: { todo: 'identity-todo' } });
    const document = { format: TRANSFER_FORMAT as typeof TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Hub' }, boards: [entry] };
    const parsed = parseTransferDocument(JSON.parse(serializeTransferDocument(document)));
    expect(parsed.boards[0]).toEqual(entry);
  });

  it('writes null for an absent optional field instead of omitting it', () => {
    const parsed = parseTransferDocument(exportPayload());
    expect(serializeTransferDocument(parsed)).toContain('"projectKeys":null');
    expect(serializeTransferDocument(parsed)).toContain('"stageIdentities":null');
  });
});
