import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { readStagePositions, setStagePositions } from '../../src/domain/workflow-positions.js';

const nl = String.fromCharCode(10);
const authored = [
  '# Delivery flow',
  'name: Delivery',
  'columns:',
  '  - id: todo',
  '    label: To do',
  '    position: {x: 10, y: 20}',
  '    allowed_transitions: [ doing ]',
  '  - id: doing',
  '    label: Doing',
  '    on_enter_prompt: |',
  '      Implement the task.',
  '  - id: done',
  '    label: Done',
  '',
].join(nl);

describe('stage positions', () => {
  it('reads the authored placements', () => {
    expect(readStagePositions(parseWorkflow(authored))).toEqual({ todo: { x: 10, y: 20 } });
  });

  it('adds a position without touching comments, prompts, or unrelated collections', () => {
    const output = setStagePositions(authored, { todo: { x: 10, y: 20 }, doing: { x: 400, y: 20 } });
    expect(output).toContain('# Delivery flow');
    expect(output).toContain('on_enter_prompt: |');
    expect(output).toContain('Implement the task.');
    expect(output).toContain('allowed_transitions: [ doing ]');
    const parsed = parseWorkflow(output);
    expect(parsed.columns[1]?.position).toEqual({ x: 400, y: 20 });
    expect(parsed.columns[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('updates an existing position in place', () => {
    const output = setStagePositions(authored, { todo: { x: 33, y: 44 } });
    expect(output).toContain('position: {x: 33, y: 44}');
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 33, y: 44 });
  });

  it('removes the position key of a stage with no requested placement', () => {
    const output = setStagePositions(authored, {});
    expect(output).not.toContain('position');
    expect(output).toContain('# Delivery flow');
    expect(parseWorkflow(output).columns[0]?.position).toBeUndefined();
  });

  it('ignores a placement for a stage the document does not define', () => {
    const output = setStagePositions(authored, { todo: { x: 10, y: 20 }, gone: { x: 1, y: 1 } });
    expect(parseWorkflow(output).columns.map(column => column.id)).toEqual(['todo', 'doing', 'done']);
    expect(output).not.toContain('gone');
  });

  it('updates an existing flow position without eating the surrounding commas', () => {
    const flow = 'columns: [{id: one, position: {x: 1, y: 2}, label: One}, {id: two, label: Two}]';
    const output = setStagePositions(flow, { one: { x: 9, y: 8 } });
    const parsed = parseWorkflow(output);
    expect(parsed.columns[0]?.position).toEqual({ x: 9, y: 8 });
    expect(parsed.columns[0]?.name).toBe('One');
    expect(parsed.columns[1]?.name).toBe('Two');
    const removed = setStagePositions(output, {});
    expect(parseWorkflow(removed).columns[0]?.position).toBeUndefined();
    expect(parseWorkflow(removed).columns[0]?.name).toBe('One');
  });

  it('adds a position to a stage that starts inline with its dash', () => {
    const one = 'columns:' + nl + '  - id: one' + nl + '    label: One';
    const output = setStagePositions(one, { one: { x: 5, y: 6 } });
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 5, y: 6 });
    expect(output).toContain('    position: {x: 5, y: 6}');
  });

  it('edits a flow-style column without reformatting it', () => {
    const flow = 'columns: [{id: one, label: One}, {id: two, label: Two}]';
    const output = setStagePositions(flow, { one: { x: 5, y: 6 } });
    expect(output.startsWith('columns: [')).toBe(true);
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 5, y: 6 });
    const removed = setStagePositions(output, {});
    expect(parseWorkflow(removed).columns[0]?.position).toBeUndefined();
    expect(removed).toBe(flow);
  });

  it('updates a block-form position without damaging the next key', () => {
    const block = ['columns:', '  - id: one', '    label: One', '    position:', '      x: 0', '      y: 0', '    on_enter_prompt: |', '      Keep me.', ''].join(String.fromCharCode(10));
    const output = setStagePositions(block, { one: { x: 10, y: 20 } });
    expect(output).toContain('on_enter_prompt: |');
    expect(output).toContain('Keep me.');
    const parsed = parseWorkflow(output);
    expect(parsed.columns[0]?.position).toEqual({ x: 10, y: 20 });
    expect(parsed.columns[0]?.onEnterPrompt).toContain('Keep me.');
  });

  it('removes a block-form position without deleting the next key', () => {
    const block = ['columns:', '  - id: one', '    label: One', '    position:', '      x: 0', '      y: 0', '    on_enter_prompt: |', '      Keep me.', ''].join(String.fromCharCode(10));
    const output = setStagePositions(block, {});
    expect(output).not.toContain('position');
    expect(output).toContain('on_enter_prompt: |');
    expect(output).toContain('Keep me.');
    const parsed = parseWorkflow(output);
    expect(parsed.columns[0]?.position).toBeUndefined();
    expect(parsed.columns[0]?.onEnterPrompt).toContain('Keep me.');
  });

  it('adds a position inside a flow stage followed by a comment', () => {
    const flow = ['columns: [', '  {id: one, label: One}, # first', '  {id: two, label: Two}', ']', ''].join(String.fromCharCode(10));
    const output = setStagePositions(flow, { one: { x: 7, y: 8 } });
    expect(output).toContain('# first');
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 7, y: 8 });
    expect(parseWorkflow(output).columns[1]?.position).toBeUndefined();
  });
  it('handles a stage id that collides with an object property', () => {
    const yaml = ['columns:', '  - id: toString', '    label: Text', '    position: {x: 1, y: 2}', ''].join(String.fromCharCode(10));
    expect(readStagePositions(parseWorkflow(yaml))).toEqual({ toString: { x: 1, y: 2 } });
    const removed = setStagePositions(yaml, {});
    expect(removed).not.toContain('position');
    expect(parseWorkflow(removed).columns[0]?.position).toBeUndefined();
    const updated = setStagePositions(yaml, { toString: { x: 3, y: 4 } });
    expect(parseWorkflow(updated).columns[0]?.position).toEqual({ x: 3, y: 4 });
  });

  it('keeps quoted keys while editing a position', () => {
    const yaml = ['"columns":', '  - "id": one', '    "label": One', '    "position": {x: 0, y: 0}', ''].join(String.fromCharCode(10));
    const output = setStagePositions(yaml, { one: { x: 5, y: 6 } });
    expect(output).toContain('"columns"');
    expect(output).toContain('"label": One');
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 5, y: 6 });
  });

  it('inserts into a flow stage beside a comment that contains a brace', () => {
    const flow = ['columns: [', '  {id: one, label: One}, # } tricky', '  {id: two, label: Two}', ']', ''].join(String.fromCharCode(10));
    const output = setStagePositions(flow, { one: { x: 1, y: 2 } });
    expect(output).toContain('# } tricky');
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 1, y: 2 });
  });

  it('inserts into a flow stage whose single-quoted label ends in a backslash', () => {
    const quote = String.fromCharCode(39);
    const backslash = String.fromCharCode(92);
    const flow = 'columns: [{id: one, label: ' + quote + 'ends' + backslash + quote + '}]';
    const output = setStagePositions(flow, { one: { x: 4, y: 5 } });
    expect(parseWorkflow(output).columns[0]?.position).toEqual({ x: 4, y: 5 });
    expect(parseWorkflow(output).columns[0]?.name).toBe('ends' + backslash);
  });
  it('returns the document unchanged when it has no column list', () => {
    expect(setStagePositions('name: Only a name', { todo: { x: 1, y: 2 } })).toBe('name: Only a name');
  });

  it('rejects invalid YAML with the workflow code', () => {
    expect(() => setStagePositions('columns: [', {})).toThrow(expect.objectContaining({ code: 'INVALID_WORKFLOW' }));
  });
});
