import { afterEach, describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { BoardAdministration } from '../../src/host/board-administration.js';
import { MemoryHubStorage } from './helpers.js';
import { exportBoards } from '../../src/host/workflow-transfer/export.js';
import { analyzeTransfer, settlePlan } from '../../src/host/workflow-transfer/import.js';
import { encodeTransferDocument, decodeTransferDocument } from '../../src/host/workflow-transfer/archive.js';
import { TRANSFER_FORMAT, TRANSFER_VERSION } from '../../src/domain/workflow-transfer/document.js';
import {
  workflowExportRequestSchema, workflowExportResultSchema, workflowImportApplyRequestSchema,
  workflowImportPlanSchema, workflowImportReadRequestSchema, workflowImportResultSchema,
} from '../../src/shared/workflow-transfer-wire.js';

/**
 * The wire schemas are the contract between a host and a client that may be a
 * different version. Each one must accept exactly what the host produces, so a
 * surface cannot render a shape the transport would reject.
 */

const workflow = ['name: Delivery', 'columns:', '  - id: todo', '    label: To do', '  - id: done', '    label: Done', ''].join(String.fromCharCode(10));

const repositories: HubRepository[] = [];
afterEach(async () => { for (const repository of repositories.splice(0)) await repository.close(); });

async function setup() {
  const storage = new MemoryHubStorage();
  let count = 0;
  const hubs = await HubRepository.open(storage, { id: () => 'test-' + (++count), now: () => '2026-11-20T10:00:00.000Z' });
  repositories.push(hubs);
  const service = new BoardAdministration({ hubs });
  const hubId = hubs.defaultHubId();
  await service.saveWorkflow({ hubId, boardId: hubs.requireHub(hubId).boards[0]!.id, yaml: workflow });
  return { hubs, service, hubId };
}

function archiveOf(boards: Array<Record<string, unknown>>): string {
  return encodeTransferDocument({ format: TRANSFER_FORMAT, version: TRANSFER_VERSION, origin: { hubName: 'Other Hub' }, boards: boards as never }).toString('base64');
}

describe('transfer wire parity', () => {
  it('accepts the export request the surface sends', () => {
    expect(workflowExportRequestSchema.safeParse({ hubId: 'hub', boardIds: ['board'] }).success).toBe(true);
    expect(workflowExportRequestSchema.safeParse({ boardIds: [] }).success).toBe(false);
  });

  it('accepts the export result the host produces', async () => {
    const { hubs, hubId } = await setup();
    const result = exportBoards(hubs, { hubId, boardIds: hubs.requireHub(hubId).boards.map(board => board.id) }, new Date('2026-11-20T10:00:00.000Z'));
    expect(workflowExportResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts the import read request the surface sends', async () => {
    const { hubs, hubId } = await setup();
    const archive = archiveOf([{ name: 'Fresh', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }]);
    expect(workflowImportReadRequestSchema.safeParse({ hubId, archive }).success).toBe(true);
    expect(workflowImportReadRequestSchema.safeParse({ hubId }).success).toBe(false);
  });

  it('accepts the import plan the host produces, including an advisory and a conflict', async () => {
    const { hubs, hubId } = await setup();
    const existing = hubs.requireHub(hubId).boards[0]!;
    const archive = archiveOf([
      { name: 'Fresh', workflowYaml: workflow, presetMode: 'host', projectKeys: ['gone'], stageIdentities: null },
      { name: existing.name, workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null },
    ]);
    const plan = analyzeTransfer(hubs, { hubId, archive });
    const parsed = workflowImportPlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.entries.some(entry => entry.droppedProjectKeys.length > 0)).toBe(true);
    expect(parsed.success && parsed.data.entries.some(entry => entry.blockReason === 'name-conflict')).toBe(true);
  });

  it('accepts the apply request the surface sends', async () => {
    const { hubs, hubId } = await setup();
    const existing = hubs.requireHub(hubId).boards[0]!;
    const archive = archiveOf([{ name: existing.name, workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null }]);
    expect(workflowImportApplyRequestSchema.safeParse({ hubId, archive, decisions: [{ name: existing.name, settlement: 'copy', copyName: 'Copy' }] }).success).toBe(true);
    expect(workflowImportApplyRequestSchema.safeParse({ hubId, archive, decisions: [{ name: existing.name, settlement: 'rename' }] }).success).toBe(false);
  });

  it('accepts the import result the host produces, including a failure', async () => {
    const { hubs, service, hubId } = await setup();
    const existing = hubs.requireHub(hubId).boards[0]!;
    const archive = archiveOf([
      { name: 'Fresh', workflowYaml: workflow, presetMode: null, projectKeys: null, stageIdentities: null },
      { name: existing.name, workflowYaml: 'columns: []', presetMode: null, projectKeys: null, stageIdentities: null },
    ]);
    const settled = settlePlan(hubs, { hubId, archive, decisions: [] });
    const entries = settled.entries.map(entry => ({
      name: entry.name, destination: entry.destination, targetBoardId: entry.targetBoardId, copyName: entry.copyName,
      workflowYaml: settled.boards.get(entry.name.trim().toLocaleLowerCase())!.workflowYaml,
      presetMode: settled.boards.get(entry.name.trim().toLocaleLowerCase())!.presetMode,
      projectScope: undefined,
      stageIdentities: settled.boards.get(entry.name.trim().toLocaleLowerCase())!.stageIdentities,
    }));
    const result = await service.importBoards({ hubId, entries });
    expect(workflowImportResultSchema.safeParse(result).success).toBe(true);
    expect(result.outcomes.some(outcome => outcome.status === 'failed')).toBe(true);
  });

  it('reads back the exact bytes an export produced', async () => {
    const { hubs, hubId } = await setup();
    const result = exportBoards(hubs, { hubId, boardIds: hubs.requireHub(hubId).boards.map(board => board.id) });
    expect(decodeTransferDocument(Buffer.from(result.archive, 'base64')).origin.hubName).toBe('My Hub');
  });
});
