import { formatOccurrence } from '../domain/cron.js';
import { requireProject, requireSchedule } from '../domain/hub-operations.js';
import { invariant } from '../shared/errors.js';
import { requireProjectPath } from '../shared/project.js';
import type { HubSchedule, HubState, Project, ScheduleRunView } from '../shared/types.js';
import type { ScheduleArchiveWatcher } from './schedule-archive.js';
import type { ScheduleModelPort } from './schedule-model.js';
import { scheduleRunProblem } from './schedule-run-storage.js';
import type { ScheduleRunRegistry } from './schedule-runs.js';

/** One admitted occurrence. `occurrenceAt` is the instant the schedule selected. */
export interface ScheduleOccurrence {
  readonly hubId: string;
  readonly scheduleId: string;
  readonly manual: boolean;
  readonly occurrenceAt: string;
}

/** Everything one occurrence needs from the host. */
export interface ScheduleRunnerPorts {
  now(): string;
  /** Host lifetime; checked before every native side effect. */
  signal?: AbortSignal;
  requireHub(hubId: string): HubState;
  /** The project's visible native workspace, provisioned by the workspace coordinator. */
  ensureProjectWorkspace(hubId: string, project: Project): Promise<string | undefined>;
  createSession(projectPath: string, workspaceId: string | undefined): Promise<string>;
  /** Fail closed unless the conversation is canonically in the expected directory. */
  validateDirectory(sessionId: string, expected: string): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<void>;
  send(sessionId: string, prompt: string, requestId: string): Promise<void>;
  models: ScheduleModelPort;
  runs: ScheduleRunRegistry;
  watcher: ScheduleArchiveWatcher;
  report?: (error: unknown) => void;
}

/**
 * Execute exactly one admitted occurrence. Admission is reserved durably before
 * any native side effect, the execution directory is revalidated immediately
 * before the prompt, and nothing here creates or changes a task, board,
 * workflow, note, or worktree.
 */
export class ScheduleRunner {
  constructor(private readonly ports: ScheduleRunnerPorts) {}

  async run(occurrence: ScheduleOccurrence): Promise<void> {
    const { hubId, scheduleId, manual } = occurrence;
    // Refuse duplicates and persist the running marker before any side effect.
    await this.ports.runs.begin(hubId, scheduleId, manual);
    let sessionId: string | undefined;
    let created = false;
    let perRun = true;
    let archiveWhenIdle = false;
    let sent = false;
    try {
      this.checkLifetime();
      const hub = this.ports.requireHub(hubId);
      const schedule = requireSchedule(hub, scheduleId);
      const project = requireProject(hub, schedule.projectId);
      const projectPath = requireProjectPath(project);
      invariant(!project.operation, 'PROJECT_RELOCATING', 'Resolve the project relocation before running this schedule.');
      perRun = schedule.newConversation;
      archiveWhenIdle = perRun && schedule.archiveWhenIdle;
      this.checkLifetime();
      const workspaceId = await this.ports.ensureProjectWorkspace(hubId, project);
      const binding = schedule.newConversation ? undefined : this.ports.runs.continuousSession(scheduleId);
      if (binding !== undefined && await this.continuousUsable(binding, schedule, projectPath)) {
        sessionId = binding.sessionId;
      } else {
        this.checkLifetime();
        sessionId = await this.ports.createSession(projectPath, workspaceId);
        created = true;
        await this.ports.runs.markSession(scheduleId, sessionId);
        if (!schedule.newConversation) await this.ports.runs.bindContinuousSession(hubId, scheduleId, { sessionId, projectId: schedule.projectId, projectPath });
        // Register before the prompt can start a turn, so a fast turn still gets archived.
        else if (archiveWhenIdle) this.ports.watcher.register(sessionId, scheduleId);
      }
      this.checkLifetime();
      if (schedule.model !== undefined) await this.ports.models.apply(sessionId, schedule.model);
      try {
        await this.ports.renameSession(sessionId, schedule.title + ' · ' + formatOccurrence(new Date(occurrence.occurrenceAt), schedule.timeZone));
      } catch (error) {
        this.ports.report?.(error);
      }
      // Re-read the project and admit the exact directory immediately before the prompt.
      await this.assertDispatchable(hubId, scheduleId, project.id, projectPath, sessionId);
      await this.ports.send(sessionId, schedule.prompt, 'schedule:' + scheduleId + ':' + occurrence.occurrenceAt);
      sent = true;
      await this.finish(occurrence, { status: 'sent', at: this.ports.now(), manual, sessionId });
    } catch (error) {
      if (sent) throw error;
      // A conversation created for a failed occurrence is archived under the
      // same idle rules; a reused continuous conversation is never archived.
      try {
        await this.finish(occurrence, {
          status: 'failed', at: this.ports.now(), manual,
          ...(sessionId === undefined ? {} : { sessionId }),
          error: scheduleRunProblem(error),
        });
      } finally {
        if (sessionId !== undefined && created && perRun) this.watch(sessionId, scheduleId);
      }
    }
  }

  private checkLifetime(): void {
    this.ports.signal?.throwIfAborted();
  }

  /** A continuous conversation is reused only while it still belongs to this project and directory. */
  private async continuousUsable(binding: { sessionId: string; projectId: string; projectPath: string }, schedule: HubSchedule, projectPath: string): Promise<boolean> {
    if (binding.projectId !== schedule.projectId || binding.projectPath !== projectPath) return false;
    try { await this.ports.validateDirectory(binding.sessionId, projectPath); return true; }
    catch { return false; }
  }

  /** Reject a moved or relocating project and a directory that is no longer admissible. */
  private async assertDispatchable(hubId: string, scheduleId: string, expectedProjectId: string, expectedPath: string, sessionId: string): Promise<void> {
    this.checkLifetime();
    const hub = this.ports.requireHub(hubId);
    const schedule = requireSchedule(hub, scheduleId);
    const project = requireProject(hub, schedule.projectId);
    invariant(!project.operation, 'PROJECT_RELOCATING', 'The schedule project started relocating before this occurrence was sent.');
    invariant(project.id === expectedProjectId && requireProjectPath(project) === expectedPath, 'CONTEXT_CHANGED', 'The schedule project changed before this occurrence was sent.');
    await this.ports.validateDirectory(sessionId, expectedPath);
    this.checkLifetime();
  }

  /** Register and evaluate now: a failed setup leaves an idle conversation with no turn event. */
  private watch(sessionId: string, scheduleId: string): void {
    this.ports.watcher.register(sessionId, scheduleId);
    this.ports.watcher.observe(sessionId);
  }

  private async finish(occurrence: ScheduleOccurrence, outcome: ScheduleRunView): Promise<void> {
    await this.ports.runs.finish(occurrence.scheduleId, outcome);
  }
}
