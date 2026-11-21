import { describe, expect, it, vi } from 'vitest';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Board, Column, HubState, HubTask, Project, Workflow } from '../../src/shared/types.js';
import type { LocatedTask } from '../../src/host/hub-repository.js';
import { transitionTools, type TaskRoutingPort } from '../../src/host/tools/transitions.js';
import { projectWorkflowSummary } from '../../src/host/workflow-summary.js';
import { orientStage } from '../../src/domain/stage-orientation.js';
import { renderOrientationBlock } from '../../src/host/stage-orientation-text.js';
import { renderWorkflowMap } from '../../src/host/workflow-map.js';

const now = '2026-01-01T00:00:00.000Z';
// One stage per routing policy, each with a different kind, plus a plain destination.
const columns: Column[] = [
  { id: 'configured', name: 'Configured', description: 'Owns configured work.', onEnterPrompt: 'Do it.', allowedTransitions: [{ to: 'target', when: 'Done.' }] },
  { id: 'unrestricted', name: 'Unrestricted', description: 'Owns open work.', onEnterPrompt: 'Do it.' },
  { id: 'empty', name: 'Empty', allowedTransitions: [] },
  { id: 'scripted', name: 'Scripted', scripted: { language: 'bash', code: 'x', directory: 'task', exits: { ok: 'target' } } },
  { id: 'decision', name: 'Decision', decision: { question: 'Go?', options: [{ id: 'go', title: 'Go', to: 'target' }] } },
  { id: 'target', name: 'Target', description: 'Owns the target work.', onEnterPrompt: 'Do it.' },
];
const workflow: Workflow = { name: 'Flow', initialColumnId: 'configured', groups: [], columns };
const board: Board = { id: 'board', name: 'Board', workflowYaml: '', workflow, createdAt: now, updatedAt: now };
const project: Project = { id: 'project', projectKey: 'project', name: 'Project', projectPath: '/repo' };

function discovery(columnId: string): Record<string, any> {
  const task: HubTask = {
    id: 'task', boardId: 'board', projectId: 'project', title: 'Task', description: '', columnId, position: 0,
    sessionIds: ['s1'], closedSessionIds: [], effectiveCwd: '/repo', worktree: null, operation: null, createdAt: now, updatedAt: now,
  };
  const located = (): LocatedTask => ({ hubId: 'hub', hub: {} as HubState, board, project, task });
  const port: TaskRoutingPort = {
    locator: { bySession: id => id === 's1' ? located() : undefined },
    hubs: { findTask: id => id === 'task' ? located() : undefined },
    recordTransition: async () => located(),
  };
  const list = transitionTools(port).find(value => value.name === 'list_allowed_transitions')!;
  const exec = { signal: new AbortController().signal, agent: { id: 's1' }, deferContext: vi.fn(), concludeTurn: vi.fn() } as unknown as ToolRunContext;
  return list.execute({}, exec) as Promise<Record<string, any>> as never;
}

describe('stage surfaces agree on what a stage is', () => {
  for (const policy of ['configured', 'unrestricted', 'empty', 'scripted', 'decision'] as const) {
    it('reports the same kind and routing policy for a ' + policy + ' stage everywhere', async () => {
      const orientation = orientStage(workflow, policy)!;
      const summary = projectWorkflowSummary(board, { id: 'hub', name: 'Hub' }, undefined).find(record => record.kind === 'stage' && record.id === policy)!;
      const listed = await discovery(policy);
      expect(orientation.routing).toBe(policy);
      expect(summary.routePolicy).toBe(policy);
      expect(listed.routePolicy).toBe(policy);
      expect(orientation.stage.kind).toBe(summary.type);
      expect(listed.stage.kind).toBe(summary.type);
      expect(renderOrientationBlock(orientation)).toContain('Stage: ' + orientation.stage.name + ' (' + policy + '), ' + summary.type);
      expect(renderWorkflowMap({ board, hub: { id: 'hub', name: 'Hub' }, sharing: undefined })).toContain(policy + ' | ' + orientation.stage.name + ' | ' + summary.type + ' | ' + policy);
    });
  }

  it('lists no declarable target for an unrestricted stage while its orientation lists every other stage', async () => {
    const listed = await discovery('unrestricted');
    expect(listed.declarable).toBe(false);
    expect(listed.targets).toEqual([]);
    expect(orientStage(workflow, 'unrestricted')!.exits.map(exit => exit.to.id)).toEqual(['configured', 'empty', 'scripted', 'decision', 'target']);
  });

  it('gives the destination the same kind and responsibility in the orientation and in discovery', async () => {
    const listed = await discovery('configured');
    const exit = orientStage(workflow, 'configured')!.exits[0]!;
    expect(listed.targets[0]).toMatchObject({ columnId: 'target', kind: exit.to.kind, responsibility: exit.to.responsibility, when: 'Done.' });
  });
});
