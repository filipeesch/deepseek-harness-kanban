import { describe, expect, it } from 'vitest';
import { apply, type Config } from '../../src/preset-tools.js';

interface Mask { deny: string[]; released: boolean }

function harness(registered: string[]) {
  const masks: Mask[] = [];
  let onToolsChange: (() => void) | undefined;
  let onDispose: (() => void) | undefined;
  const ctx = {
    tools: {
      definitions: () => registered.map(name => ({ name })),
      restrict: (filter: { deny: string[] }) => {
        const mask: Mask = { deny: [...filter.deny], released: false };
        masks.push(mask);
        return () => { mask.released = true; };
      },
    },
    on: (event: string, handler: () => void) => {
      if (event === 'tools/change') onToolsChange = handler;
      return () => { onToolsChange = undefined; };
    },
    effect: (factory: () => () => void) => { onDispose = factory(); },
  };
  return {
    ctx,
    masks,
    config: (value: Partial<Config>) => apply(ctx as never, value),
    emitToolsChange: () => onToolsChange?.(),
    dispose: () => onDispose?.(),
  };
}

const REGISTERED = ['get_card', 'create_card', 'edit_card', 'send_task_message', 'mcp__atlassian__search', 'bash'];

describe('the preset tool boundary', () => {
  it('denies every product tool the role does not allow', () => {
    const host = harness(REGISTERED);
    host.config({ allow: ['get_card', 'send_task_message'] });
    expect(host.masks).toHaveLength(1);
    expect([...host.masks[0]!.deny].sort()).toEqual(['create_card', 'edit_card']);
  });

  it('never denies a tool that is not a product tool', () => {
    const host = harness(REGISTERED);
    host.config({ allow: [] });
    expect(host.masks[0]!.deny).not.toContain('bash');
    expect(host.masks[0]!.deny).not.toContain('mcp__atlassian__search');
  });

  it('applies no mask when every registered product tool is allowed', () => {
    const host = harness(REGISTERED);
    host.config({ allow: ['get_card', 'create_card', 'edit_card', 'send_task_message'] });
    expect(host.masks).toEqual([]);
  });

  it('denies every MCP tool when the role keeps none', () => {
    const host = harness(REGISTERED);
    host.config({ allow: ['get_card'], denyMcp: true });
    expect(host.masks[0]!.deny).toContain('mcp__atlassian__search');
    expect(host.masks[0]!.deny).toContain('create_card');
  });

  it('replaces its mask when the tool catalog changes', () => {
    const registered = [...REGISTERED];
    const host = harness(registered);
    host.config({ allow: ['get_card'], denyMcp: true });
    registered.push('mcp__trino__execute_query');
    host.emitToolsChange();
    expect(host.masks).toHaveLength(2);
    expect(host.masks[0]!.released).toBe(true);
    expect(host.masks[1]!.deny).toContain('mcp__trino__execute_query');
  });

  it('lifts its mask when the preset unloads', () => {
    const host = harness(REGISTERED);
    host.config({ allow: [] });
    host.dispose();
    expect(host.masks[0]!.released).toBe(true);
  });
});

describe('the preset tool boundary and the registry notification', () => {
  it('does not reapply an unchanged mask, so its own notification cannot spread', () => {
    const registered = [...REGISTERED];
    const masks: Mask[] = [];
    let onChange: (() => void) | undefined;
    let listening = false;
    const ctx = {
      tools: {
        definitions: () => registered.map(name => ({ name })),
        restrict: (filter: { deny: string[] }) => {
          const mask: Mask = { deny: [...filter.deny], released: false };
          masks.push(mask);
          if (listening) onChange?.();
          return () => { mask.released = true; };
        },
      },
      on: (event: string, handler: () => void) => {
        if (event === 'tools/change') onChange = handler;
        return () => { onChange = undefined; };
      },
      effect: (factory: () => () => void) => { factory(); },
    };
    apply(ctx as never, { allow: ['get_card'], denyMcp: true });
    expect(masks).toHaveLength(1);

    listening = true;
    onChange?.();
    expect(masks).toHaveLength(1);

    registered.push('mcp__trino__execute_query');
    onChange?.();
    expect(masks).toHaveLength(2);
    expect(masks[0]!.released).toBe(true);
    expect(masks[1]!.deny).toContain('mcp__trino__execute_query');
  });
});
