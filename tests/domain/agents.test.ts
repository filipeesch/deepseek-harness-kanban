import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { agentFor, declaredAgents, stageAgent, stageAgentId } from '../../src/domain/agents.js';
import { effectiveBoardModel, effectiveBoardPreset } from '../../src/domain/board-preset.js';
import { writeBoardAgentsField, writeStageAgentField } from '../../src/domain/board-agents-field.js';
import { agentConversationId, mainConversationId, ownsStage, stageConversationId } from '../../src/domain/conversation-role.js';
import { addHeldMessage, dropHeldMessages, heldMessagesFor, takeHeldMessage } from '../../src/domain/held-message.js';
import { diffWorkflow } from '../../src/domain/workflow-difference.js';
import { workflowWarnings } from '../../src/domain/workflow-warnings.js';
import type { Board, Task, Workflow } from '../../src/shared/types.js';

const FLOW = [
  'name: Flow',
  'initial_column: backlog',
  'agents:',
  '  - id: designer',
  '    name: UX Design',
  '    preset: ux',
  '    model:',
  '      provider: deepseek',
  '      model: reason',
  'columns:',
  '  - id: backlog',
  '    label: Backlog',
  '  - id: design',
  '    label: Design',
  '    agent: designer',
  '    on_enter_prompt: Design it.',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

function boardOf(workflow: Workflow, defaultPresetMode?: 'operator' | 'host'): Pick<Board, 'workflow' | 'defaultPresetMode'> {
  return { workflow, ...(defaultPresetMode === undefined ? {} : { defaultPresetMode }) };
}

describe('board agents in the workflow document', () => {
  it('parses the agents list and the stage reference', () => {
    const workflow = parseWorkflow(FLOW);
    expect(declaredAgents(workflow)).toEqual([{ id: 'designer', name: 'UX Design', preset: 'ux', model: { provider: 'deepseek', model: 'reason' } }]);
    expect(workflow.columns.find(column => column.id === 'design')?.agent).toBe('designer');
    expect(stageAgentId(workflow.columns.find(column => column.id === 'design'))).toBe('designer');
    expect(stageAgent(workflow, 'design')?.id).toBe('designer');
    expect(stageAgent(workflow, 'backlog')).toBeUndefined();
  });

  it('resolves the main agent even when the document authors none', () => {
    const workflow = parseWorkflow('name: Flow\ninitial_column: a\ncolumns:\n  - id: a\n    label: A\n');
    expect(agentFor(workflow, 'main')).toEqual({ id: 'main', name: 'Main' });
    expect(agentFor(workflow, 'designer')).toBeUndefined();
  });

  it('rejects a stage that names an undeclared agent', () => {
    expect(() => parseWorkflow(FLOW.replace('agent: designer', 'agent: missing'))).toThrow(/unknown agent/);
  });

  it('rejects duplicate agent identities and an empty preset', () => {
    expect(() => parseWorkflow(FLOW.replace('  - id: designer\n    name: UX Design', '  - id: designer\n    name: UX Design\n  - id: designer\n    name: Other'))).toThrow(/unique/);
    expect(() => parseWorkflow(FLOW.replace('    preset: ux', "    preset: ''"))).toThrow(/preset must be nonempty/);
  });

  it('rejects an agent on a scripted or decision stage', () => {
    const scripted = FLOW.replace('    on_enter_prompt: Design it.', '    scripted:\n      language: bash\n      code: echo hi\n      directory: task\n      exits:\n        ok: done');
    expect(() => parseWorkflow(scripted)).toThrow(/scripted stage cannot also name an agent/);
    const decision = FLOW.replace('    on_enter_prompt: Design it.', '    decision:\n      question: Continue?\n      options:\n        - id: go\n          title: Go\n          to: done');
    expect(() => parseWorkflow(decision)).toThrow(/decision stage cannot also name an agent/);
  });

  it('counts an agent or stage binding change as workflow meaning', () => {
    const before = parseWorkflow(FLOW);
    const after = parseWorkflow(FLOW.replace('    preset: ux', '    preset: ux2').replace('agent: designer', ''));
    const difference = diffWorkflow(before, after);
    expect(difference.workflow.map(field => field.field)).toContain('agents');
    expect(difference.stages.find(stage => stage.stage === 'design')?.fields?.map(field => field.field)).toContain('agent');
  });
});

describe('board default resolution through the main agent', () => {
  const withMain = (lines: string[]) => parseWorkflow(['name: Flow', 'initial_column: a', 'agents:', ...lines, 'columns:', '  - id: a', '    label: A', ''].join('\n'));

  it('takes the authored main preset over the legacy scalar and metadata', () => {
    const workflow = withMain(['  - id: main', '    name: Main', '    preset: operator']);
    expect(effectiveBoardPreset(boardOf(workflow, 'host'))).toEqual({ preset: 'operator', origin: 'authored' });
  });

  it('reads a main agent without a preset as the explicit host default', () => {
    const workflow = withMain(['  - id: main', '    name: Main']);
    expect(effectiveBoardPreset(boardOf(workflow, 'operator'))).toEqual({ origin: 'explicit-host' });
  });

  it('keeps the legacy resolution when no main agent is authored', () => {
    const legacy = parseWorkflow('name: Flow\ninitial_column: a\nagent_preset: standard\ncolumns:\n  - id: a\n    label: A\n');
    expect(effectiveBoardPreset(boardOf(legacy))).toEqual({ preset: 'standard', origin: 'authored' });
    expect(effectiveBoardPreset(boardOf(parseWorkflow('name: Flow\ninitial_column: a\ncolumns:\n  - id: a\n    label: A\n'), 'operator'))).toEqual({ preset: 'kanban-workflow-operator', origin: 'implicit-operator' });
  });

  it('resolves the main model from the main agent before the legacy root mapping', () => {
    const workflow = withMain(['  - id: main', '    name: Main', '    model:', '      provider: deepseek', '      model: reason']);
    expect(effectiveBoardModel(workflow)).toEqual({ provider: 'deepseek', model: 'reason' });
    const legacy = parseWorkflow('name: Flow\ninitial_column: a\nmodel:\n  provider: deepseek\n  model: chat\ncolumns:\n  - id: a\n    label: A\n');
    expect(effectiveBoardModel(legacy)).toEqual({ provider: 'deepseek', model: 'chat' });
  });
});

describe('agent authoring writers', () => {
  it('inserts the agents section into a legacy document and preserves its comments', () => {
    const authored = '# The team flow\nname: Flow\ninitial_column: backlog\ncolumns:\n  - id: backlog\n    label: Backlog # keep me\n';
    const next = writeBoardAgentsField(authored, [{ id: 'main', name: 'Main' }, { id: 'designer', name: 'UX Design', preset: 'ux' }]);
    expect(next).toContain('# The team flow');
    expect(next).toContain('label: Backlog # keep me');
    expect(next).toContain('agents:');
    expect(parseWorkflow(next).agents).toHaveLength(2);
  });

  it('replaces the whole section and clears it once no stage names an agent', () => {
    const next = writeBoardAgentsField(FLOW, [{ id: 'main', name: 'Main', preset: 'operator' }, { id: 'designer', name: 'UX Design Two', preset: 'ux2' }]);
    const workflow = parseWorkflow(next);
    expect(declaredAgents(workflow).map(agent => agent.name)).toEqual(['Main', 'UX Design Two']);
    expect(workflow.columns.find(column => column.id === 'design')?.agent).toBe('designer');
    expect(next).toContain('Design it.');
    // Removing an agent a stage still names composes an invalid document, which the
    // writer refuses; clearing the reference first makes the removal valid.
    expect(() => writeBoardAgentsField(FLOW, [{ id: 'main', name: 'Main' }])).toThrow(/unknown agent/);
    const unbound = writeStageAgentField(FLOW, 'design', undefined);
    const cleared = writeBoardAgentsField(unbound, undefined);
    expect(parseWorkflow(cleared).agents).toBeUndefined();
    expect(cleared).toContain('Design it.');
  });

  it('binds and clears one stage agent without touching the rest', () => {
    const bound = writeStageAgentField(FLOW, 'backlog', 'designer');
    expect(parseWorkflow(bound).columns.find(column => column.id === 'backlog')?.agent).toBe('designer');
    expect(bound).toContain('Design it.');
    const cleared = writeStageAgentField(bound, 'design', undefined);
    expect(parseWorkflow(cleared).columns.find(column => column.id === 'design')?.agent).toBeUndefined();
  });

  it('warns about a stage whose agent never starts and about an unavailable preset', () => {
    const workflow = parseWorkflow(FLOW.replace('    on_enter_prompt: Design it.', ''));
    const warnings = workflowWarnings(workflow, [], { presets: ['other'] });
    expect(warnings.some(warning => warning.kind === 'agent-without-instruction' && warning.stage === 'design')).toBe(true);
    expect(warnings.some(warning => warning.kind === 'agent-preset-unavailable' && warning.agent === 'designer')).toBe(true);
  });
});

describe('conversation roles', () => {
  const workflow = parseWorkflow(FLOW);
  const task = {
    sessionIds: ['main-1', 'designer-1'], closedSessionIds: [], sessionRoles: { 'designer-1': { agent: 'designer' } },
    columnId: 'design',
  } as unknown as Task & { columnId: string };

  it('derives the main conversation and the agent conversation from the records', () => {
    expect(mainConversationId(task)).toBe('main-1');
    expect(agentConversationId(task, 'designer')).toBe('designer-1');
    expect(stageConversationId(task, workflow, 'design')).toBe('designer-1');
    expect(stageConversationId(task, workflow, 'backlog')).toBe('main-1');
    expect(stageConversationId(task, workflow, 'done')).toBe('main-1');
  });

  it('treats a closed conversation as still owning its stage', () => {
    const closed = { ...task, closedSessionIds: ['designer-1'] } as unknown as Task & { columnId: string };
    expect(stageConversationId(closed, workflow, 'design')).toBeUndefined();
    expect(ownsStage(closed, workflow, 'design', 'designer-1')).toBe(true);
    expect(ownsStage(closed, workflow, 'design', 'main-1')).toBe(false);
  });
});

describe('held message queue', () => {
  const message = { id: 'held:s:1', fromSessionId: 's', columnId: 'design', body: 'Result', at: '2026-01-01T00:00:00.000Z' };
  it('adds once per identity and reads by stage', () => {
    const task: Pick<Task, 'heldMessages'> = {};
    expect(addHeldMessage(task, message)).toBe(true);
    expect(addHeldMessage(task, message)).toBe(false);
    expect(heldMessagesFor(task, 'design')).toHaveLength(1);
    expect(heldMessagesFor(task, 'done')).toHaveLength(0);
    expect(takeHeldMessage(task, 'held:s:1')).toEqual(message);
    expect(task.heldMessages).toBeUndefined();
  });

  it('drops the messages a predicate names and keeps the rest', () => {
    const task: Pick<Task, 'heldMessages'> = {};
    addHeldMessage(task, { ...message, id: 'a' });
    addHeldMessage(task, { ...message, id: 'b', columnId: 'done' });
    const dropped = dropHeldMessages(task, value => value.columnId === 'design');
    expect(dropped.map(value => value.id)).toEqual(['a']);
    expect(task.heldMessages?.map(value => value.id)).toEqual(['b']);
  });
});
