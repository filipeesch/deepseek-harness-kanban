import { describe, expect, it } from 'vitest';
import type { HubSchedule, Project } from '../../src/shared/types.js';
import {
  browserTimeZone, createScheduleDraft, draftCatalogModel, editScheduleDraft, formatOccurrence, presetFor, scheduleDraftDescription,
  scheduleDraftError, scheduleDraftOccurrences, toScheduleCommand,
} from '../../src/client/settings/schedules/schedule-draft.js';

const projects: Project[] = [{ id: 'project', projectKey: 'web', name: 'Web', projectPath: '/repo/web' }];
const schedule: HubSchedule = {
  id: 'schedule', title: 'Morning', prompt: 'Summarize', cron: '0 9 * * *', timeZone: 'Europe/Lisbon', projectId: 'project',
  model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' }, newConversation: true, archiveWhenIdle: true, enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('schedule draft', () => {
  it('creates a draft from a stored schedule and round-trips it through the command', () => {
    const draft = createScheduleDraft(schedule);
    expect(draft).toMatchObject({ scheduleId: 'schedule', title: 'Morning', modelMode: 'custom', modelProvider: 'deepseek', modelName: 'reason', reasoningEffort: 'high' });
    expect(toScheduleCommand(draft, 'hub', 7)).toMatchObject({
      type: 'schedule.save', hubId: 'hub', scheduleId: 'schedule', title: 'Morning', cron: '0 9 * * *', timeZone: 'Europe/Lisbon',
      model: { provider: 'deepseek', model: 'reason', reasoningEffort: 'high' }, newConversation: true, archiveWhenIdle: true, expectedRevision: 7,
    });
  });

  it('defaults a new schedule to enabled-equivalent options and the browser zone', () => {
    const draft = createScheduleDraft(undefined, 'UTC');
    expect(draft).toMatchObject({ title: '', prompt: '', projectId: '', newConversation: true, archiveWhenIdle: true, modelMode: 'default', reasoningEffort: '' });
    expect(draft.timeZone).toBe('UTC');
    expect(browserTimeZone().length).toBeGreaterThan(0);
    expect(toScheduleCommand(draft, 'hub')).not.toHaveProperty('model');
    expect(toScheduleCommand(draft, 'hub')).not.toHaveProperty('expectedRevision');
  });

  it('disables archiving when the conversation is continuous', () => {
    const draft = editScheduleDraft(createScheduleDraft(undefined, 'UTC'), 'newConversation', false);
    expect(draft.archiveWhenIdle).toBe(false);
    expect(toScheduleCommand(draft, 'hub')).toMatchObject({ newConversation: false, archiveWhenIdle: false });
    const back = editScheduleDraft(draft, 'newConversation', true);
    expect(back.archiveWhenIdle).toBe(false);
  });

  it('reports the first invalid field', () => {
    const base = createScheduleDraft(undefined, 'UTC');
    expect(scheduleDraftError(base, projects)).toMatch(/title/);
    expect(scheduleDraftError({ ...base, title: 'x'.repeat(121) }, projects)).toMatch(/at most 120/);
    expect(scheduleDraftError({ ...base, title: 'Run' }, projects)).toMatch(/prompt/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it' }, projects)).toMatch(/project/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it', projectId: 'missing' }, projects)).toMatch(/this Hub/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it', projectId: 'project', timeZone: 'Mars/Olympus' }, projects)).toMatch(/time zone/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it', projectId: 'project', cron: '61 * * * *' }, projects)).toMatch(/minute/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it', projectId: 'project', modelMode: 'custom' }, projects)).toMatch(/model/);
    expect(scheduleDraftError({ ...base, title: 'Run', prompt: 'Do it', projectId: 'project' }, projects)).toBeNull();
  });


  it('preserves the reasoning effort and validates the catalog route', () => {
    const catalog = { default: { provider: 'deepseek', model: 'chat' }, providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'reason', name: 'Reason', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }], failures: [] };
    const draft = createScheduleDraft(schedule);
    expect(draftCatalogModel(draft, catalog)?.id).toBe('reason');
    expect(scheduleDraftError(draft, projects, catalog)).toBeNull();
    expect(scheduleDraftError({ ...draft, modelName: 'gone' }, projects, catalog)).toMatch(/host catalog/);
    expect(scheduleDraftError({ ...draft, modelName: 'gone' }, projects, null)).toBeNull();
    const changed = { ...draft, modelName: 'other', reasoningEffort: '' };
    expect(toScheduleCommand(changed, 'hub').model).toEqual({ provider: 'deepseek', model: 'other' });
  });

  it('describes and previews a valid expression, and fails soft while invalid', () => {
    const draft = createScheduleDraft(undefined, 'UTC');
    expect(scheduleDraftDescription(draft)).toBe('Every day at 09:00');
    expect(scheduleDraftOccurrences(draft, new Date('2026-01-01T00:00:00Z'))).toEqual(['2026-01-01 09:00', '2026-01-02 09:00', '2026-01-03 09:00']);
    const invalid = { ...draft, cron: 'nope' };
    expect(scheduleDraftDescription(invalid)).toBeNull();
    expect(scheduleDraftOccurrences(invalid)).toEqual([]);
    expect(formatOccurrence(new Date('2026-01-01T09:00:00Z'), 'Europe/Lisbon')).toBe('2026-01-01 09:00');
  });

  it('maps expressions to their quick choice', () => {
    expect(presetFor('0 * * * *')).toBe('hourly');
    expect(presetFor('0 0 * * *')).toBe('daily');
    expect(presetFor('0 0 * * 1')).toBe('weekly');
    expect(presetFor('*/5 * * * *')).toBe('manual');
  });
});