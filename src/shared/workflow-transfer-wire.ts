import { z } from 'zod';
import type {
  WorkflowExportRequest, WorkflowExportResult, WorkflowImportApplyRequest, WorkflowImportDecision,
  WorkflowImportEntry, WorkflowImportOutcome, WorkflowImportPlan, WorkflowImportReadRequest, WorkflowImportResult,
} from './types.js';
import { TRANSFER_MAX_COMPRESSED_BYTES } from '../domain/workflow-transfer/document.js';

/**
 * The wire shapes of workflow transfer.
 *
 * The host validates every one of them before doing any work, and the client
 * decodes the same shapes, so an older peer cannot half-understand a document.
 * The archive travels as base64 text, which is what the browser's download and
 * file selection produce and consume without the client ever compressing.
 */

const identifier = z.string().min(1).max(200);
const hubId = identifier.optional();
/** The largest base64 text the compressed limit can occupy, with envelope slack. */
const archiveText = z.string().min(1).max(Math.ceil(TRANSFER_MAX_COMPRESSED_BYTES / 3) * 4 + 1024);

export const workflowExportRequestSchema: z.ZodType<WorkflowExportRequest> = z.object({
  hubId,
  boardIds: z.array(identifier).min(1).max(500),
}).strict();

export const workflowExportAdvisorySchema = z.object({
  boardName: z.string().min(1), reason: z.literal('external-script-source'), detail: z.string().min(1),
}).strict();

export const workflowExportResultSchema: z.ZodType<WorkflowExportResult> = z.object({
  archive: archiveText, fileName: z.string().min(1), boardCount: z.number().int().nonnegative(),
  advisories: z.array(workflowExportAdvisorySchema),
}).strict();

const destination = z.enum(['create', 'replace', 'copy', 'skip', 'blocked']);
const blockReason = z.enum(['invalid-workflow', 'name-conflict']).nullable();
const orphanSchema = z.object({ columnId: identifier, stageIdentity: identifier, cards: z.number().int().nonnegative() }).strict();
const realignmentSchema = z.object({ from: identifier, to: identifier, cards: z.number().int().nonnegative() }).strict();

export const workflowImportEntrySchema: z.ZodType<WorkflowImportEntry> = z.object({
  name: z.string().min(1),
  destination,
  targetBoardId: identifier.nullable(),
  copyName: z.string().min(1).nullable(),
  orphaned: z.array(orphanSchema),
  realigned: z.array(realignmentSchema),
  droppedProjectKeys: z.array(z.string().min(1)),
  scopeOpened: z.boolean(),
  blockReason,
  detail: z.string().nullable(),
  externalScriptSources: z.array(z.string().min(1)),
}).strict();

export const workflowImportPlanSchema: z.ZodType<WorkflowImportPlan> = z.object({
  hubId: identifier, origin: z.string(), entries: z.array(workflowImportEntrySchema).min(1),
}).strict();

export const workflowImportReadRequestSchema: z.ZodType<WorkflowImportReadRequest> = z.object({ hubId, archive: archiveText }).strict();

export const workflowImportDecisionSchema: z.ZodType<WorkflowImportDecision> = z.object({
  name: z.string().min(1), settlement: z.enum(['replace', 'copy', 'skip']), copyName: z.string().min(1).max(200).optional(), targetBoardId: identifier.nullable().optional(),
}).strict();

export const workflowImportApplyRequestSchema: z.ZodType<WorkflowImportApplyRequest> = z.object({
  hubId, archive: archiveText, decisions: z.array(workflowImportDecisionSchema).max(500),
}).strict();

export const workflowImportOutcomeSchema: z.ZodType<WorkflowImportOutcome> = z.object({
  name: z.string().min(1),
  status: z.enum(['created', 'replaced', 'skipped', 'failed']),
  boardId: identifier.optional(),
  reason: z.string().optional(),
  code: identifier.optional(),
}).strict();

export const workflowImportResultSchema: z.ZodType<WorkflowImportResult> = z.object({
  hubId: identifier, outcomes: z.array(workflowImportOutcomeSchema),
}).strict();
