import { describe, expect, it } from 'vitest';
import { parseWorkflow } from '../../src/domain/workflow.js';
import { setStagePositions } from '../../src/domain/workflow-positions.js';
import { readStageSizes, setStageSizes } from '../../src/domain/workflow-sizes.js';

const nl = String.fromCharCode(10);
const authored = [
  '# Delivery flow',
  'name: Delivery',
  'columns:',
  '  - id: todo',
  '    label: To do',
  '    size: {width: 400, height: 300}',
  '    allowed_transitions: [ doing ]',
  '  - id: doing',
  '    label: Doing',
  '    on_enter_prompt: |',
  '      Implement the task.',
  '  - id: done',
  '    label: Done',
  '',
].join(nl);

describe('stage sizes', () => {
  it('reads the authored sizes', () => {
    expect(readStageSizes(parseWorkflow(authored))).toEqual({ todo: { width: 400, height: 300 } });
  });

  it('adds a size without touching comments, prompts, or unrelated collections', () => {
    const output = setStageSizes(authored, { todo: { width: 400, height: 300 }, doing: { width: 320, height: 200 } });
    expect(output).toContain('# Delivery flow');
    expect(output).toContain('on_enter_prompt: |');
    expect(output).toContain('Implement the task.');
    expect(output).toContain('allowed_transitions: [ doing ]');
    const parsed = parseWorkflow(output);
    expect(parsed.columns[1]?.size).toEqual({ width: 320, height: 200 });
    expect(parsed.columns[0]?.size).toEqual({ width: 400, height: 300 });
  });

  it('updates an existing size in place', () => {
    const output = setStageSizes(authored, { todo: { width: 500, height: 420 } });
    expect(output).toContain('size: {width: 500, height: 420}');
    expect(parseWorkflow(output).columns[0]?.size).toEqual({ width: 500, height: 420 });
  });

  it('removes the size key of a stage with no requested size', () => {
    const output = setStageSizes(authored, {});
    expect(output).not.toContain('size');
    expect(output).toContain('# Delivery flow');
    expect(parseWorkflow(output).columns[0]?.size).toBeUndefined();
  });

  it('ignores a size for a stage the document does not define', () => {
    const output = setStageSizes(authored, { todo: { width: 400, height: 300 }, gone: { width: 300, height: 300 } });
    expect(parseWorkflow(output).columns.map(column => column.id)).toEqual(['todo', 'doing', 'done']);
    expect(output).not.toContain('gone');
  });

  it('edits a flow-style column without reformatting it', () => {
    const flow = 'columns: [{id: one, label: One}, {id: two, label: Two}]';
    const output = setStageSizes(flow, { one: { width: 300, height: 250 } });
    expect(output.startsWith('columns: [')).toBe(true);
    expect(parseWorkflow(output).columns[0]?.size).toEqual({ width: 300, height: 250 });
    const removed = setStageSizes(output, {});
    expect(parseWorkflow(removed).columns[0]?.size).toBeUndefined();
    expect(removed).toBe(flow);
  });

  it('adds a size to a stage that starts inline with its dash', () => {
    const one = 'columns:' + nl + '  - id: one' + nl + '    label: One';
    const output = setStageSizes(one, { one: { width: 300, height: 250 } });
    expect(parseWorkflow(output).columns[0]?.size).toEqual({ width: 300, height: 250 });
    expect(output).toContain('    size: {width: 300, height: 250}');
  });

  it('updates a block-form size without damaging the next key', () => {
    const block = ['columns:', '  - id: one', '    label: One', '    size:', '      width: 300', '      height: 250', '    on_enter_prompt: |', '      Keep me.', ''].join(nl);
    const output = setStageSizes(block, { one: { width: 400, height: 300 } });
    expect(output).toContain('on_enter_prompt: |');
    expect(parseWorkflow(output).columns[0]?.size).toEqual({ width: 400, height: 300 });
    expect(parseWorkflow(output).columns[0]?.onEnterPrompt).toBe('Keep me.\n');
  });

  it('removes a size that starts the sequence item without dropping the dash', () => {
    const inline = ['columns:', '  - size: {width: 400, height: 300}', '    id: one', '    label: One', ''].join(nl);
    const output = setStageSizes(inline, {});
    expect(parseWorkflow(output).columns[0]?.id).toBe('one');
    expect(parseWorkflow(output).columns[0]?.size).toBeUndefined();
    expect(output).toContain('  -');
  });

  it('removes a block size that starts the sequence item', () => {
    const block = ['columns:', '  - size:', '      width: 400', '      height: 300', '    id: one', '    label: One', ''].join(nl);
    const output = setStageSizes(block, {});
    expect(parseWorkflow(output).columns[0]?.id).toBe('one');
    expect(parseWorkflow(output).columns[0]?.size).toBeUndefined();
  });

  it('keeps position and size independent', () => {
    const positioned = setStagePositions(authored, { todo: { x: 10, y: 20 } });
    const sized = setStageSizes(positioned, { todo: { width: 500, height: 420 } });
    expect(parseWorkflow(sized).columns[0]?.position).toEqual({ x: 10, y: 20 });
    expect(parseWorkflow(sized).columns[0]?.size).toEqual({ width: 500, height: 420 });
  });
});
