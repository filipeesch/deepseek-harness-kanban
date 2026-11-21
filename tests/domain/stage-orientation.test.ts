import { describe, expect, it } from 'vitest';
import type { Workflow } from '../../src/shared/types.js';
import { orientStage, stageReference } from '../../src/domain/stage-orientation.js';

const workflow: Workflow = {
  name: 'Flow',
  initialColumnId: 'plan',
  groups: [],
  columns: [
    { id: 'plan', name: 'Plan', description: 'Owns the plan.', onEnterPrompt: 'SECRET INSTRUCTION', allowedTransitions: [{ to: 'build', when: 'The plan is agreed.' }, { to: 'park' }] },
    { id: 'build', name: 'Build', description: 'Owns the implementation.', onEnterPrompt: 'Build it.' },
    { id: 'park', name: 'Park' },
    { id: 'check', name: 'Check', scripted: { language: 'bash', code: 'SECRET SCRIPT', directory: 'task', exits: { passed: 'build', failed: 'park' } } },
    { id: 'gate', name: 'Gate', description: 'Waits for a person.', decision: { question: 'Go?', context: 'SECRET CONTEXT', options: [{ id: 'go', title: 'Go', description: 'SECRET OPTION', to: 'build' }, { id: 'stop', title: 'Stop', to: 'park' }] } },
    { id: 'end', name: 'End', allowedTransitions: [] },
  ],
};

describe('stage orientation', () => {
  it('orients a stage with configured transitions and only the authored condition', () => {
    const value = orientStage(workflow, 'plan')!;
    expect(value.stage).toEqual({ id: 'plan', name: 'Plan', kind: 'agent-instruction', responsibility: 'Owns the plan.' });
    expect(value.routing).toBe('configured');
    expect(value.exits).toEqual([
      { to: { id: 'build', name: 'Build', kind: 'agent-instruction', responsibility: 'Owns the implementation.' }, condition: 'The plan is agreed.' },
      { to: { id: 'park', name: 'Park', kind: 'no-instruction' } },
    ]);
  });

  it('lists every other stage as an exit of an unrestricted stage', () => {
    const value = orientStage(workflow, 'build')!;
    expect(value.routing).toBe('unrestricted');
    expect(value.exits.map(exit => exit.to.id)).toEqual(['plan', 'park', 'check', 'gate', 'end']);
    expect(value.exits.every(exit => exit.condition === undefined)).toBe(true);
  });

  it('reports no exit for a stage that permits none', () => {
    const value = orientStage(workflow, 'end')!;
    expect(value.routing).toBe('empty');
    expect(value.exits).toEqual([]);
  });

  it('names each exit of a scripted stage and carries no script code', () => {
    const value = orientStage(workflow, 'check')!;
    expect(value.stage.kind).toBe('scripted');
    expect(value.routing).toBe('scripted');
    expect(value.exits.map(exit => [exit.exit, exit.to.id])).toEqual([['passed', 'build'], ['failed', 'park']]);
    expect(JSON.stringify(value)).not.toContain('SECRET');
  });

  it('names each option of a decision stage without answering it or carrying a description', () => {
    const value = orientStage(workflow, 'gate')!;
    expect(value.stage.kind).toBe('decision');
    expect(value.routing).toBe('decision');
    expect(value.exits.map(exit => [exit.option, exit.to.id])).toEqual([[{ id: 'go', title: 'Go' }, 'build'], [{ id: 'stop', title: 'Stop' }, 'park']]);
    expect(JSON.stringify(value)).not.toContain('SECRET');
  });

  it('leaves an absent or blank responsibility absent', () => {
    expect(stageReference({ id: 'a', name: 'A' })).toEqual({ id: 'a', name: 'A', kind: 'no-instruction' });
    expect(stageReference({ id: 'a', name: 'A', description: '   ' }).responsibility).toBeUndefined();
  });

  it('never leaks an entry instruction', () => {
    expect(JSON.stringify(orientStage(workflow, 'plan'))).not.toContain('SECRET');
  });

  it('has no orientation for an unknown stage and skips an exit to an unknown stage', () => {
    expect(orientStage(workflow, 'missing')).toBeUndefined();
    const dangling: Workflow = { ...workflow, columns: [{ id: 'a', name: 'A', scripted: { language: 'bash', code: 'x', directory: 'task', exits: { done: 'ghost' } } }] };
    expect(orientStage(dangling, 'a')!.exits).toEqual([]);
  });
});
