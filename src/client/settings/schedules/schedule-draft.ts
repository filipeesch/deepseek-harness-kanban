import type { Command, HubSchedule, Project, ModelCatalog, ModelProvider, ModelSelection } from '../../../shared/types.js';
import { assertSchedulable, describeCron, formatOccurrence, isTimeZone, nextOccurrences } from '../../../domain/cron.js';
export { formatOccurrence };

/** Quick choices that only fill the expression; the expression stays editable. */
export const CRON_PRESETS = [
  { id: 'hourly', label: 'Hourly', cron: '0 * * * *' },
  { id: 'daily', label: 'Daily', cron: '0 0 * * *' },
  { id: 'weekly', label: 'Weekly', cron: '0 0 * * 1' },
  { id: 'manual', label: 'Manual', cron: undefined },
] as const;

/** A short list of common zones offered beside free entry. */
export const COMMON_TIME_ZONES = ['UTC', 'Europe/Lisbon', 'Europe/London', 'America/New_York', 'America/Sao_Paulo', 'Asia/Tokyo'] as const;

export const MAX_SCHEDULE_TITLE = 120;
export const MAX_SCHEDULE_PROMPT = 20_000;

/** The editable draft of one schedule. */
export interface ScheduleDraft {
  scheduleId?: string;
  title: string;
  prompt: string;
  cron: string;
  timeZone: string;
  projectId: string;
  modelMode: 'default' | 'custom';
  modelProvider: string;
  modelName: string;
  reasoningEffort: string;
  newConversation: boolean;
  archiveWhenIdle: boolean;
}

/** The browser's zone, used as the default for a new schedule. */
export function browserTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function createScheduleDraft(schedule?: HubSchedule, timeZone = browserTimeZone()): ScheduleDraft {
  return {
    ...(schedule === undefined ? {} : { scheduleId: schedule.id }),
    title: schedule?.title ?? '',
    prompt: schedule?.prompt ?? '',
    cron: schedule?.cron ?? '0 9 * * *',
    timeZone: schedule?.timeZone ?? timeZone,
    projectId: schedule?.projectId ?? '',
    modelMode: schedule?.model === undefined ? 'default' : 'custom',
    modelProvider: schedule?.model?.provider ?? '',
    modelName: schedule?.model?.model ?? '',
    reasoningEffort: schedule?.model?.reasoningEffort ?? '',
    newConversation: schedule?.newConversation ?? true,
    archiveWhenIdle: schedule?.archiveWhenIdle ?? true,
  };
}

/** Apply one field change, keeping the archive option consistent with the session mode. */
export function editScheduleDraft(draft: ScheduleDraft, field: keyof ScheduleDraft, value: string | boolean): ScheduleDraft {
  const next: ScheduleDraft = { ...draft, [field]: value };
  if (field === 'newConversation') next.archiveWhenIdle = value === true ? draft.archiveWhenIdle : false;
  return next;
}

/** The stored model selection, or undefined for the host default. */
export function draftModel(draft: ScheduleDraft): ModelSelection | undefined {
  if (draft.modelMode !== 'custom') return undefined;
  const provider = draft.modelProvider.trim();
  const model = draft.modelName.trim();
  if (!provider || !model) return undefined;
  const reasoningEffort = draft.reasoningEffort.trim();
  return { provider, model, ...(reasoningEffort === '' ? {} : { reasoningEffort }) };
}

/** Choose between the host default and a specific route without discarding an entered route. */
export function editScheduleDraftModelMode(draft: ScheduleDraft, mode: 'default' | 'custom'): ScheduleDraft {
  return {
    ...draft,
    modelMode: mode,
    ...(mode === 'default' ? { modelProvider: '', modelName: '', reasoningEffort: '' } : {}),
  };
}

/** Move the draft onto one route, or back to the deployment default; the route key stays in the domain. */
export function editScheduleDraftModel(draft: ScheduleDraft, selection: ModelSelection | undefined): ScheduleDraft {
  return {
    ...draft,
    modelMode: selection === undefined ? 'default' : 'custom',
    modelProvider: selection?.provider ?? '',
    modelName: selection?.model ?? '',
    reasoningEffort: selection?.reasoningEffort ?? '',
  };
}

/** The catalog entry for the draft's current route, when the catalog advertises it. */
export function draftCatalogModel(draft: ScheduleDraft, catalog: ModelCatalog | null): ModelProvider['models'][number] | undefined {
  if (draft.modelMode !== 'custom' || catalog === null) return undefined;
  return catalog.providers.find(provider => provider.id === draft.modelProvider)?.models.find(model => model.id === draft.modelName);
}

/** The first reason the draft cannot be saved, or null when it can. */
export function scheduleDraftError(draft: ScheduleDraft, projects: readonly Project[], catalog: ModelCatalog | null = null): string | null {
  const title = draft.title.trim();
  if (!title) return 'A schedule title is required.';
  if (title.length > MAX_SCHEDULE_TITLE) return 'A schedule title must be at most ' + MAX_SCHEDULE_TITLE + ' characters.';
  const prompt = draft.prompt.trim();
  if (!prompt) return 'A prompt is required.';
  if (prompt.length > MAX_SCHEDULE_PROMPT) return 'A prompt must be at most ' + MAX_SCHEDULE_PROMPT + ' characters.';
  if (!draft.projectId) return 'Choose the project the schedule runs in.';
  if (!projects.some(project => project.id === draft.projectId)) return 'Choose a project from this Hub.';
  if (!isTimeZone(draft.timeZone)) return 'Choose a known IANA time zone.';
  try { assertSchedulable(draft.cron, draft.timeZone); }
  catch (error) { return error instanceof Error ? error.message : 'The cron expression is invalid.'; }
  if (draft.modelMode === 'custom' && draftModel(draft) === undefined) return 'Choose a model or use the host default.';
  if (catalog !== null && draft.modelMode === 'custom' && draftCatalogModel(draft, catalog) === undefined) {
    return 'Choose a model from the host catalog or use the host default.';
  }
  return null;
}

/** The plain-language description of the current expression, or null while invalid. */
export function scheduleDraftDescription(draft: ScheduleDraft): string | null {
  try { return describeCron(draft.cron); } catch { return null; }
}

/** The next occurrences for the draft, or an empty list while the expression is invalid. */
export function scheduleDraftOccurrences(draft: ScheduleDraft, from = new Date(), count = 3): string[] {
  try { return nextOccurrences(draft.cron, draft.timeZone, from, count).map(date => formatOccurrence(date, draft.timeZone)); }
  catch { return []; }
}

/** The preset that matches the expression exactly, or manual. */
export function presetFor(cron: string): string {
  const match = CRON_PRESETS.find(preset => preset.cron !== undefined && preset.cron === cron.trim());
  return match?.id ?? 'manual';
}

export function toScheduleCommand(draft: ScheduleDraft, hubId: string, expectedRevision?: number): Extract<Command, { type: 'schedule.save' }> {
  const model = draftModel(draft);
  return {
    type: 'schedule.save', hubId,
    ...(draft.scheduleId === undefined ? {} : { scheduleId: draft.scheduleId }),
    title: draft.title.trim(), prompt: draft.prompt.trim(), cron: draft.cron.trim(), timeZone: draft.timeZone.trim(), projectId: draft.projectId,
    ...(model === undefined ? {} : { model }),
    newConversation: draft.newConversation, archiveWhenIdle: draft.newConversation ? draft.archiveWhenIdle : false,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  };
}
