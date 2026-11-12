import { afterEach, describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolActivationContext } from '@deepseek-ai/dsh-tools';
import { fixture } from './helpers.js';
import { registerProductTools, WORKFLOW_ARCHITECT_PRESET, WORKFLOW_DESIGN_TOOLS } from '../../src/host/tools.js';

const active: Array<Awaited<ReturnType<typeof fixture>>> = [];
afterEach(async () => { for (const f of active.splice(0).reverse()) await f.close(); });

interface Registration { readonly name: string; readonly when?: (context: ToolActivationContext) => boolean }

function fakeContext(projection: { presetForSession?: (session: unknown) => string | null } | undefined) {
  const registrations: Registration[] = [];
  const context = {
    tools: {
      get: () => undefined,
      register: (definition: { name: string }, options: { when?: (context: ToolActivationContext) => boolean } = {}) => {
        registrations.push({ name: definition.name, ...(options.when === undefined ? {} : { when: options.when }) });
        return () => {};
      },
    },
    get: (service: string) => (service === 'agentPresets' ? projection : undefined),
  };
  return { context: context as unknown as Context, registrations };
}

function activation(preset: string | null): ToolActivationContext {
  return { agent: { session: { preset } }, modelSelection: {}, signal: new AbortController().signal } as unknown as ToolActivationContext;
}

async function register(projection: { presetForSession?: (session: unknown) => string | null } | undefined) {
  const f = await fixture();
  active.push(f);
  const { context, registrations } = fakeContext(projection);
  const dispose = registerProductTools(context, f.app);
  return { registrations, dispose };
}

describe('workflow design tool visibility', () => {
  it('gates every workflow design tool and leaves the rest ungated', async () => {
    const { registrations, dispose } = await register({ presetForSession: () => WORKFLOW_ARCHITECT_PRESET });
    dispose();
    const gated = registrations.filter(entry => entry.when !== undefined).map(entry => entry.name).sort();
    expect(gated).toEqual([...WORKFLOW_DESIGN_TOOLS].sort());
    expect(registrations.find(entry => entry.name === 'get_board_summary')?.when).toBeUndefined();
    expect(registrations.find(entry => entry.name === 'create_board')?.when).toBeUndefined();
  });

  it('declares the tools only for the workflow architect preset', async () => {
    const { registrations } = await register({ presetForSession: (session: unknown) => (session as { preset: string }).preset });
    const gate = registrations.find(entry => entry.name === 'render_workflow_diagram')!.when!;
    expect(gate(activation(WORKFLOW_ARCHITECT_PRESET))).toBe(true);
    expect(gate(activation('some-other-preset'))).toBe(false);
    expect(gate(activation(null))).toBe(false);
  });

  it('withholds the tools when the preset projection is unavailable', async () => {
    const missing = await register(undefined);
    expect(missing.registrations.find(entry => entry.name === 'get_board_yaml')!.when!(activation(WORKFLOW_ARCHITECT_PRESET))).toBe(false);
    const withoutState = await register({});
    expect(withoutState.registrations.find(entry => entry.name === 'get_board_yaml')!.when!(activation(WORKFLOW_ARCHITECT_PRESET))).toBe(false);
    const failing = await register({ presetForSession: () => { throw new Error('projection unavailable'); } });
    expect(failing.registrations.find(entry => entry.name === 'get_board_yaml')!.when!(activation(WORKFLOW_ARCHITECT_PRESET))).toBe(false);
  });
});
