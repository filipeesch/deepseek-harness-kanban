import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import { productToolDefinitions } from '../../src/host/tools.js';
import { DESCRIPTION_CEILING } from '../../src/domain/workflow-warnings.js';
import { fixture } from './helpers.js';

type F = Awaited<ReturnType<typeof fixture>> & { tools: ToolDefinition[] };
const active: F[] = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

async function setup(): Promise<F> {
  const f = await fixture();
  const value: F = { ...f, tools: productToolDefinitions(f.app) };
  active.push(value);
  return value;
}

const exec = (): ToolRunContext => ({ signal: new AbortController().signal, agent: { id: 'ordinary-session' }, deferContext: vi.fn(), concludeTurn: vi.fn() }) as unknown as ToolRunContext;
const run = (f: F, name: string, args: Record<string, unknown>): Promise<any> => f.tools.find(tool => tool.name === name)!.execute(args, exec()) as Promise<any>;

/** A workflow that trips every stage-contract observation at once. */
const long = 'r'.repeat(DESCRIPTION_CEILING + 1);
const WORKFLOW = [
  'name: Observed',
  'initial_column: intake',
  'columns:',
  '  - id: intake',
  '    label: Intake',
  '    description: ' + long,
  '    on_enter_prompt: Collect the facts.',
  '    allowed_transitions:',
  '      - to: work',
  '        when: The facts are complete.',
  '      - to: done',
  '  - id: work',
  '    label: Work',
  '    on_enter_prompt: Do the work.',
  '    allowed_transitions: [done]',
  '  - id: done',
  '    label: Done',
  '',
].join('\n');

describe('stage-contract observations in a persisted write', () => {
  it('saves the document and reports each observation without blocking the write', async () => {
    const f = await setup();
    const created = await run(f, 'create_board', { hub_id: f.hub.id, name: 'Observed board', workflow_yaml: WORKFLOW });
    expect(created.saved).toBe(true);
    const warnings = created.report.warnings as Array<Record<string, unknown>>;
    expect(warnings).toContainEqual({ kind: 'description-over-ceiling', stage: 'intake', length: DESCRIPTION_CEILING + 1 });
    expect(warnings).toContainEqual({ kind: 'destination-without-condition', stage: 'intake', destination: 'done' });
    expect(warnings).toContainEqual({ kind: 'stage-without-description', stage: 'work' });
    expect(warnings.some(warning => warning.kind === 'stage-without-description' && warning.stage === 'intake')).toBe(false);
    const stored = await run(f, 'get_board_yaml', { board_id: created.id });
    expect(stored.yaml).toContain(long);
  });

  it('reports the same observations for a review that saves nothing', async () => {
    const f = await setup();
    const reviewed = await run(f, 'validate_workflow', { yaml: WORKFLOW });
    const warnings = JSON.stringify(reviewed);
    expect(warnings).toContain('description-over-ceiling');
    expect(warnings).toContain('destination-without-condition');
    expect(warnings).toContain('stage-without-description');
  });
});
