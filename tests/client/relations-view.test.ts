import { describe, expect, it } from 'vitest';
import type { BoardRelation } from '../../src/shared/types.js';
import { buildRelationRows } from '../../src/client/relations/relations-view.js';

function relation(overrides: Partial<BoardRelation> = {}): BoardRelation {
  return { id: 'r', type: 'epic', from: 'epic', to: 'child', ...overrides };
}

describe('relation rows', () => {
  it('labels an outgoing epic, an incoming epic, and a symmetric relation', () => {
    const rows = buildRelationRows({
      taskId: 'card',
      taskBoardId: 'board',
      relations: [
        relation({ id: 'a', type: 'epic', from: 'card', to: 'child', toTitle: 'Child', toStageName: 'Apply' }),
        relation({ id: 'b', type: 'epic', from: 'parent', to: 'card', fromTitle: 'Parent', fromStageName: 'Explore' }),
        relation({ id: 'c', type: 'related', from: 'card', to: 'peer', toTitle: 'Peer', toStageName: 'Review' }),
      ],
    });
    expect(rows.map(row => row.label)).toEqual(['Epic of Child', 'Belongs to epic Parent', 'Related to Peer']);
    expect(rows.map(row => row.direction)).toEqual(['outgoing', 'incoming', 'symmetric']);
    expect(rows.map(row => row.stage)).toEqual(['Apply', 'Explore', 'Review']);
  });

  it('ignores a relation of another pair and never repeats the local board', () => {
    const rows = buildRelationRows({
      taskId: 'card',
      taskBoardId: 'board',
      relations: [
        relation({ id: 'other', from: 'a', to: 'b' }),
        relation({ id: 'local', from: 'card', to: 'peer', toTitle: 'Peer', toBoardId: 'board', toBoardName: 'Same board' }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.board).toBeUndefined();
  });

  it('names the board of a card that lives elsewhere', () => {
    const rows = buildRelationRows({
      taskId: 'card',
      taskBoardId: 'board',
      relations: [relation({ from: 'card', to: 'peer', toTitle: 'Peer', toBoardId: 'infra', toBoardName: 'Infrastructure' })],
    });
    expect(rows[0]!.board).toBe('Infrastructure');
  });

  it('falls back to a neutral title when the other card could not be resolved', () => {
    const rows = buildRelationRows({ taskId: 'card', taskBoardId: 'board', relations: [relation({ from: 'card', to: 'ghost' })] });
    expect(rows[0]!.label).toBe('Epic of Untitled card');
    expect(rows[0]!.stage).toBeUndefined();
  });
});
