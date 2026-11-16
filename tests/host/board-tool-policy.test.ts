import { describe, expect, it, vi } from 'vitest';
import { createBoardToolPolicy, type PolicyAgent } from '../../src/host/board-tool-policy.js';

function agent(id: string): PolicyAgent {
  return { session: { id } };
}

interface HarnessOptions {
  allowlist?: (sessionId: string) => readonly string[] | undefined;
  catalog?: readonly string[];
  restrictThrows?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const catalog = options.catalog ?? ['mcp__atlassian__search', 'mcp__atlassian__createJiraIssue', 'mcp__trino__execute_query', 'bash', 'get_card'];
  const restrictions: Array<{ agent: PolicyAgent; deny: readonly string[]; released: boolean }> = [];
  const report = vi.fn();
  const policy = createBoardToolPolicy({
    policy: { allowlist: options.allowlist ?? (() => ['atlassian/search']) },
    catalog: () => catalog,
    restrict: (target, deny) => {
      if (options.restrictThrows === true) throw new Error('restrict failed');
      const entry = { agent: target, deny: [...deny], released: false };
      restrictions.push(entry);
      return () => { entry.released = true; };
    },
    report,
  });
  return { policy, restrictions, report, catalog };
}

describe('the board MCP tool policy', () => {
  it('denies the MCP tools a board does not allow, naming nothing outside that namespace', () => {
    const { policy, restrictions } = harness();
    policy.track(agent('session-1'));
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0]!.deny).toEqual(['mcp__atlassian__createJiraIssue', 'mcp__trino__execute_query']);
    expect(restrictions[0]!.deny).not.toContain('bash');
    expect(restrictions[0]!.deny).not.toContain('get_card');
  });

  it('applies no mask when the board names no allowlist', () => {
    const { policy, restrictions } = harness({ allowlist: () => undefined });
    policy.track(agent('session-1'));
    expect(restrictions).toEqual([]);
  });

  it('applies no mask for a session that belongs to no board', () => {
    const { policy, restrictions } = harness({ allowlist: () => undefined });
    policy.track(agent('ordinary-chat'));
    expect(restrictions).toEqual([]);
  });

  it('denies every MCP tool when the board keeps none', () => {
    const { policy, restrictions } = harness({ allowlist: () => [] });
    policy.track(agent('session-1'));
    expect(restrictions[0]!.deny).toEqual(['mcp__atlassian__search', 'mcp__atlassian__createJiraIssue', 'mcp__trino__execute_query']);
  });

  it('allows a whole server through a bare entry', () => {
    const { policy, restrictions } = harness({ allowlist: () => ['atlassian'] });
    policy.track(agent('session-1'));
    expect(restrictions[0]!.deny).toEqual(['mcp__trino__execute_query']);
  });

  it('waits for the catalog before masking a server that is not connected yet', () => {
    const catalog: string[] = [];
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    const policy = createBoardToolPolicy({
      policy: { allowlist: () => ['atlassian/search'] },
      catalog: () => catalog,
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; };
      },
    });
    policy.track(agent('session-1'));
    expect(restrictions).toEqual([]);
    catalog.push('mcp__atlassian__search', 'mcp__atlassian__createJiraIssue');
    policy.refresh();
    expect(restrictions).toHaveLength(1);
    expect(restrictions[0]!.deny).toEqual(['mcp__atlassian__createJiraIssue']);
  });

  it('replaces the mask instead of stacking one on refresh', () => {
    const catalog = ['mcp__atlassian__search'];
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    const policy = createBoardToolPolicy({
      policy: { allowlist: () => [] },
      catalog: () => catalog,
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; };
      },
    });
    policy.track(agent('session-1'));
    catalog.push('mcp__trino__execute_query');
    policy.refresh();
    expect(restrictions).toHaveLength(2);
    expect(restrictions[0]!.released).toBe(true);
    expect(restrictions[1]!.deny).toEqual(['mcp__atlassian__search', 'mcp__trino__execute_query']);
  });

  it('lifts the mask of the disposed agent, and every mask on disposal', () => {
    const first = harness();
    const live = agent('session-1');
    first.policy.track(live);
    first.policy.forget(live);
    expect(first.restrictions[0]!.released).toBe(true);

    const second = harness();
    second.policy.track(agent('session-1'));
    second.policy.dispose();
    expect(second.restrictions[0]!.released).toBe(true);
  });

  it('keeps the replacement agent mask when the replaced instance is disposed', () => {
    const host = harness();
    const replaced = agent('session-1');
    const replacement = agent('session-1');
    host.policy.track(replaced);
    host.policy.track(replacement);
    host.policy.forget(replaced);
    expect(host.restrictions[0]!.released).toBe(true);
    expect(host.restrictions[1]!.released).toBe(false);
  });

  it('reports a failing restriction instead of throwing into the host', () => {
    const { policy, report } = harness({ restrictThrows: true });
    expect(() => policy.track(agent('session-1'))).not.toThrow();
    expect(report).toHaveBeenCalledOnce();
  });
});

describe('the board policy snapshot', () => {
  it('keeps the allowlist the agent started with when the board changes and the catalog refreshes', () => {
    let allowlist: readonly string[] = ['atlassian/search'];
    const catalog = ['mcp__atlassian__search', 'mcp__atlassian__createJiraIssue'];
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    const policy = createBoardToolPolicy({
      policy: { allowlist: () => allowlist },
      catalog: () => catalog,
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; };
      },
    });
    const session = agent('session-1');
    policy.track(session);
    expect(restrictions[0]!.deny).toEqual(['mcp__atlassian__createJiraIssue']);

    // The board is edited and a new server connects: the running agent keeps the
    // allowlist it started with, so the edit takes effect on its next start.
    allowlist = ['trino'];
    catalog.push('mcp__trino__execute_query');
    policy.refresh();

    expect(restrictions).toHaveLength(2);
    // The snapshot still allows only atlassian/search, so the tool that just connected is denied.
    expect(restrictions[1]!.deny).toEqual(['mcp__atlassian__createJiraIssue', 'mcp__trino__execute_query']);
  });

  it('takes a new board allowlist on the next start of the same session', () => {
    let allowlist: readonly string[] = ['atlassian'];
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    const policy = createBoardToolPolicy({
      policy: { allowlist: () => allowlist },
      catalog: () => ['mcp__atlassian__search', 'mcp__trino__execute_query'],
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; };
      },
    });
    policy.track(agent('session-1'));
    expect(restrictions[0]!.deny).toEqual(['mcp__trino__execute_query']);
    allowlist = ['trino'];
    policy.track(agent('session-1'));
    expect(restrictions[1]!.deny).toEqual(['mcp__atlassian__search']);
  });

  it('stops masking a session whose board no longer names an allowlist', () => {
    let allowlist: readonly string[] | undefined = ['atlassian/search'];
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    const policy = createBoardToolPolicy({
      policy: { allowlist: () => allowlist },
      catalog: () => ['mcp__atlassian__search', 'mcp__atlassian__createJiraIssue'],
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; };
      },
    });
    policy.track(agent('session-1'));
    expect(restrictions).toHaveLength(1);
    allowlist = undefined;
    policy.track(agent('session-1'));
    expect(restrictions[0]!.released).toBe(true);
    policy.refresh();
    expect(restrictions).toHaveLength(1);
  });
});

describe('the board policy and the registry notification', () => {
  it('ignores the change notification its own mask application emits', () => {
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    let policy: ReturnType<typeof createBoardToolPolicy>;
    policy = createBoardToolPolicy({
      policy: { allowlist: () => [] },
      catalog: () => ['mcp__atlassian__search'],
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        // Applying a restriction emits tools/change synchronously; the policy must not
        // reenter itself through that notification.
        policy.refresh();
        return () => { entry.released = true; };
      },
    });
    policy.track(agent('session-1'));
    expect(restrictions).toHaveLength(1);
  });

  it('ignores a change notification emitted while a mask is lifted', () => {
    const restrictions: Array<{ deny: readonly string[]; released: boolean }> = [];
    let policy: ReturnType<typeof createBoardToolPolicy>;
    policy = createBoardToolPolicy({
      policy: { allowlist: () => [] },
      catalog: () => ['mcp__atlassian__search'],
      restrict: (_target, deny) => {
        const entry = { deny: [...deny], released: false };
        restrictions.push(entry);
        return () => { entry.released = true; policy.refresh(); };
      },
    });
    const live = agent('session-1');
    policy.track(live);
    policy.forget(live);
    expect(restrictions).toHaveLength(1);
  });
});
