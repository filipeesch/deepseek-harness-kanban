import { describe, expect, it } from 'vitest';
import type { Column } from '../../src/shared/types.js';
import { routingOwner, routingPolicy, stageKind } from '../../src/domain/stage-kind.js';

const scripted: NonNullable<Column['scripted']> = { language: 'bash', code: 'exit 0', directory: 'task', exits: { done: 'done' } };
const decision: NonNullable<Column['decision']> = { question: 'Ship it?', options: [{ id: 'yes', title: 'Yes', to: 'done' }] };

describe('stage kind', () => {
  it('classifies a decision gate before anything else it carries', () => {
    expect(stageKind({ decision, onEnterPrompt: 'ignored' })).toBe('decision');
  });

  it('classifies a scripted stage', () => {
    expect(stageKind({ scripted })).toBe('scripted');
  });

  it('classifies a stage with an entry instruction as agentic', () => {
    expect(stageKind({ onEnterPrompt: 'Do the work.' })).toBe('agent-instruction');
  });

  it('classifies a stage with neither a script nor an instruction', () => {
    expect(stageKind({})).toBe('no-instruction');
  });

  it('treats a blank instruction as no instruction', () => {
    expect(stageKind({ onEnterPrompt: '  \n  ' })).toBe('no-instruction');
  });
});

describe('routing policy', () => {
  it('reports a gate, a script, and the three transition-list shapes', () => {
    expect(routingPolicy({ decision })).toBe('decision');
    expect(routingPolicy({ scripted })).toBe('scripted');
    expect(routingPolicy({})).toBe('unrestricted');
    expect(routingPolicy({ allowedTransitions: [] })).toBe('empty');
    expect(routingPolicy({ allowedTransitions: [{ to: 'done' }] })).toBe('configured');
  });

  it('lets a gate or a script own the routing whatever list the stage carries', () => {
    expect(routingPolicy({ decision, allowedTransitions: [{ to: 'done' }] })).toBe('decision');
    expect(routingPolicy({ scripted, allowedTransitions: [] })).toBe('scripted');
  });
});

describe('routing owner', () => {
  it('names the owner of the routing out of a stage', () => {
    expect(routingOwner({ scripted })).toBe('scripted');
    expect(routingOwner({ decision })).toBe('decision');
    expect(routingOwner({})).toBe('stage');
    expect(routingOwner(undefined)).toBe('stage');
  });
});
