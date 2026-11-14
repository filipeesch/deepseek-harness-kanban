import type { DeterministicCapture, DeterministicControl, DeterministicHandoff, DeterministicInput, DeterministicInputHandoff } from '../../shared/deterministic.js';
import { KanbanError } from '../../shared/errors.js';
import { declaredParameterValues } from '../../domain/deterministic-parameters.js';
import type { LocatedTask } from '../hub-repository.js';

/** Strip the raw sent map: a program receives values only through its declared parameter input. */
function programHandoff(handoff: DeterministicHandoff): DeterministicInputHandoff {
  const { params: _params, ...rest } = handoff;
  return structuredClone(rest);
}

/**
 * The one structured program input. Pure over the task, its entry, and its
 * captured authority: no I/O, no secret resolution, and no interpolation of
 * task text or parameter values into source.
 */
export function buildDeterministicInput(located: LocatedTask, control: DeterministicControl, capture: DeterministicCapture): DeterministicInput {
  const task = located.task;
  const projectDirectory = located.project.projectPath;
  if (projectDirectory === undefined) throw new KanbanError('PROJECT_DIRECTORY_REQUIRED', 'Adopt the project directory before running a script.');
  return {
    task: { id: task.id, title: task.title, description: task.description },
    hub: { id: located.hubId },
    board: { id: located.board.id },
    stage: { id: task.columnId, identity: control.stageIdentity },
    project: { id: located.project.id, directory: projectDirectory },
    directory: capture.executionDirectory,
    worktree: task.worktree ? { path: task.worktree.path, branch: task.worktree.branch } : null,
    entryId: control.entryId,
    enteredAt: task.stageEntry?.enteredAt,
    executionId: control.executionId,
    startedAt: control.startedAt,
    attemptId: control.attemptId,
    attempt: control.attempt,
    restartCount: control.restartCount,
    params: declaredParameterValues(capture.params, control.parameters),
    ...(task.deterministicHandoff?.entryId === control.entryId ? { handoff: programHandoff(task.deterministicHandoff) } : {}),
  };
}
