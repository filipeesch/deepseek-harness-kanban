import { randomUUID } from 'node:crypto';
import { ensureLocalStageIdentity } from '../domain/deterministic-state.js';
import { KanbanError } from '../shared/errors.js';
import type { DeterministicTarget } from '../shared/deterministic.js';
import type { DeterministicRuntime, DeterministicScope } from './deterministic/ports.js';
import type { SupervisorPorts, SupervisorRequest } from './deterministic-supervisor.js';

export interface NativeSupervisorPorts extends Omit<SupervisorPorts, 'capture' | 'runtime' | 'trust' | 'variable'> {
  nativeRuntime: DeterministicRuntime;
  removeTaskSources?(taskId: string, referencedSourceRefs: readonly string[]): Promise<void>;
}
function scope(request: Pick<SupervisorRequest, 'located' | 'control'>): DeterministicScope {
  return { hubId: request.located.hubId, boardId: request.located.board.id, projectId: request.located.project.id, stageIdentity: request.control.stageIdentity };
}

/** Bind the task authority ports to native capture/execution; never copy native secret storage. */
export function createNativeSupervisorPorts(options: NativeSupervisorPorts): SupervisorPorts {
  const { nativeRuntime: native, removeTaskSources, ...base } = options;
  return { ...base,
    capture: {
      async capture(request) {
        const exits = await base.transact(request.located.task.id, (task, located) => {
          if (!request.preview && (task.stageEntry?.id !== request.control.entryId || task.deterministic?.executionId !== request.control.executionId)) throw new KanbanError('STALE_EXECUTION', 'This executable entry has been replaced.');
          if (request.control.targets) return structuredClone(request.control.targets);
          const targets: Record<string, DeterministicTarget> = {};
          for (const [exit, columnId] of Object.entries(request.control.definition.exits)) {
            targets[exit] = { columnId, stageIdentity: ensureLocalStageIdentity(located.board, columnId, base.id ?? randomUUID) };
          }
          return targets;
        });
        const projectDirectory = request.located.project.projectPath;
        if (!projectDirectory) throw new KanbanError('PROJECT_DIRECTORY_REQUIRED', 'Adopt the project directory before running a script.');
        return native.capture({ definition: request.control.definition, projectDirectory, taskDirectory: request.located.task.effectiveCwd, exits, signal: request.signal });
      },
      load: capture => native.loadCapture(capture),
      collectSources: references => native.collectSources(references),
      releaseSource: reference => native.releaseSource?.(reference),
      ...(removeTaskSources ? { removeTask: removeTaskSources } : {}),
    },
    runtime: {
      reclaim: request => native.reclaim(request.control.executionId),
      reclaimTask: located => native.reclaimTask?.({hubId:located.hubId,boardId:located.board.id,projectId:located.project.id,stageIdentity:located.task.stageEntry?.stageIdentity ?? 'unbound'},located.task.id) ?? Promise.resolve(),
      async execute(request) {
        await native.verify(request.capture, request.signal);
        if (request.signal.aborted) throw new KanbanError('EXECUTION_ABORTED', 'The execution was canceled.');
        const input = JSON.parse(JSON.stringify(request.input)) as Parameters<DeterministicRuntime['execute']>[0]['input'];
        const outcome = await native.execute({ executionId: request.control.executionId, taskId: request.located.task.id, capture: request.capture, input, scope: scope(request), signal: request.signal });
        if (outcome.kind === 'completed') return outcome.completion;
        if (outcome.kind === 'failed') {
          if (outcome.diagnostic.code === 'OWNERSHIP_UNCERTAIN') base.report?.(new KanbanError(outcome.diagnostic.code, outcome.diagnostic.message));
          throw new KanbanError(outcome.diagnostic.code, outcome.diagnostic.message);
        }
        throw new KanbanError('EXECUTION_ABORTED', 'The execution was canceled.');
      },
    },
    trust: {
      isApproved: request => native.trust.isApproved(scope(request), request.capture.fingerprint),
      approve: request => native.trust.approve(scope(request), request.capture.fingerprint),
    },
    variable: {
      resolve: request => native.variables.resolve(scope(request), request.capture.env),
      status: request => native.variables.status(scope(request), request.capture.env),
      set: (located, stageIdentity, name, value) => value === null
        ? native.variables.remove({ hubId: located.hubId, boardId: located.board.id, projectId: located.project.id, stageIdentity }, name)
        : native.variables.set({ hubId: located.hubId, boardId: located.board.id, projectId: located.project.id, stageIdentity }, name, value),
    },
  };
}
