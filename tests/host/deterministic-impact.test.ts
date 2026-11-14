import { describe, expect, it } from 'vitest';
import { createDeterministicImpact } from '../../src/host/deterministic-impact.js';
import type { CapturePlan, DeterministicApprovalScope, DeterministicRuntime } from '../../src/host/deterministic/ports.js';
import { parseWorkflow } from '../../src/domain/workflow.js';
import type { Board, HubState, Project, Workflow } from '../../src/shared/types.js';

const DEFINITION = 'columns:\n  - id: wait\n    label: Wait\n    deterministic:\n      language: bash\n      code: exit 0\n      directory: project\n      exits: {passed: review}\n  - id: review\n    label: Review\n    allowed_transitions: []\n';

function projectOf(id: string, path?: string): Project {
  return { id, name: id, projectKey: id, origin: 'local', ...(path === undefined ? {} : { projectPath: path }) } as unknown as Project;
}

function boardOf(yaml: string, identities: Record<string, string> = {}): Board {
  return { id: 'board', allowedProjectKeys: undefined, localStageIdentities: identities, workflow: parseWorkflow(yaml) } as unknown as Board;
}

interface FakeOptions { readonly approved?: readonly string[] }

function fakeRuntime(options: FakeOptions = {}) {
  const approved = new Set(options.approved ?? []);
  const scopes: DeterministicApprovalScope[] = [];
  const runtime = {
    async plan(request: Parameters<DeterministicRuntime['plan']>[0]): Promise<CapturePlan> {
      // The version excludes the execution directory; the project only supplies bytes.
      const fingerprint = JSON.stringify([request.definition, request.exits]);
      return { content: { language: request.definition.language, directory: request.definition.directory, executionDirectory: request.projectDirectory, source: { kind: 'inline' }, env: [...(request.definition.env ?? [])], params: [], exits: request.exits }, code: request.definition.code ?? '', fingerprint };
    },
    trust: {
      async isApproved(scope: DeterministicApprovalScope, fingerprint: string) { scopes.push(scope); return approved.has(scope.stageIdentity + ':' + fingerprint); },
      async approve() {},
    },
  } as unknown as DeterministicRuntime;
  return { runtime, approved, scopes };
}

const hubOf = (projects: readonly Project[]): HubState => ({ id: 'hub', projects } as unknown as HubState);

function impact(runtime: DeterministicRuntime, hub: HubState, board: Board, before: Workflow | null, after: Workflow) {
  return createDeterministicImpact(() => runtime).describe({ hub, board, before, after });
}
function approvedKey(definition: unknown, exits: unknown, stageIdentity = 'wait-key') {
  return stageIdentity + ':' + JSON.stringify([definition, exits]);
}

describe('deterministic script impact', () => {
  it('reports one verdict per stage instead of one per project', async () => {
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one'), projectOf('p2', '/project/two')]), board, after, after);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ stage: 'wait', verdict: 'changed', reasons: ['unapproved'] });
  });

  it('reports an approved version as holding once for the board', async () => {
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const definition = after.columns[0]!.deterministic!;
    const exits = { passed: { columnId: 'review', stageIdentity: 'review-key' } };
    const approved = fakeRuntime({ approved: [approvedKey(definition, exits)] });
    const result = await impact(approved.runtime, hubOf([projectOf('p1', '/project/one'), projectOf('p2', '/project/two')]), board, after, after);
    expect(result[0]).toMatchObject({ verdict: 'holds', reasons: [] });
    expect(approved.scopes).toEqual([{ hubId: 'hub', boardId: 'board', stageIdentity: 'wait-key' }]);
  });

  it('names the exits as the reason a retargeted destination no longer holds', async () => {
    const before = parseWorkflow(DEFINITION.replace('exits: {passed: review}', 'exits: {passed: other}').replace('  - id: review\n    label: Review\n    allowed_transitions: []\n', '  - id: review\n    label: Review\n  - id: other\n    label: Other\n'));
    const after = parseWorkflow(DEFINITION.replace('  - id: review\n    label: Review\n    allowed_transitions: []\n', '  - id: review\n    label: Review\n  - id: other\n    label: Other\n'));
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key', other: 'other-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]).toMatchObject({ verdict: 'changed', reasons: ['exits'] });
  });

  it('names the source as the reason changed bytes no longer hold', async () => {
    const before = parseWorkflow(DEFINITION);
    const after = parseWorkflow(DEFINITION.replace('code: exit 0', 'code: exit 1'));
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]).toMatchObject({ verdict: 'changed', reasons: ['source'] });
  });

  it('names the environment as the reason changed variables no longer hold', async () => {
    const before = parseWorkflow(DEFINITION);
    const after = parseWorkflow(DEFINITION.replace('code: exit 0', 'code: exit 0\n      env: [TOKEN]'));
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]).toMatchObject({ verdict: 'changed', reasons: ['environment'] });
  });

  it('names a changed parameter declaration as the reason it no longer holds', async () => {
    const before = parseWorkflow(DEFINITION);
    const after = parseWorkflow(DEFINITION.replace('code: exit 0', 'code: exit 0\n      params: [{name: pipeline}]'));
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]).toMatchObject({ verdict: 'changed', reasons: ['parameters'] });
  });

  it('names the working-directory choice as the reason it no longer holds', async () => {
    const before = parseWorkflow(DEFINITION.replace('directory: project', 'directory: task'));
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]!.reasons).toContain('directory');
  });

  it('judges a changed authored key with the identity the save will keep', async () => {
    const keyed = DEFINITION.replace('    label: Wait', '    label: Wait\n    key: old-wait');
    const rekeyed = DEFINITION.replace('    label: Wait', '    label: Wait\n    key: new-wait');
    const before = parseWorkflow(keyed);
    const after = parseWorkflow(rekeyed);
    const board = { id: 'board', allowedProjectKeys: undefined, workflow: before, localStageIdentities: { wait: 'old-wait', review: 'review-key' } } as unknown as Board;
    const approved = fakeRuntime({ approved: [] });
    const result = await impact(approved.runtime, hubOf([projectOf('p1', '/project/one')]), board, before, after);
    expect(result[0]).toMatchObject({ verdict: 'changed', reasons: ['unapproved'] });
    expect(approved.scopes).toEqual([{ hubId: 'hub', boardId: 'board', stageIdentity: 'new-wait' }]);
  });

  it('reports a relative external source as directory-dependent instead of claiming a board result', async () => {
    const yaml = DEFINITION.replace('code: exit 0', 'file: wait.sh');
    const after = parseWorkflow(yaml);
    const board = boardOf(yaml, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, after, after);
    expect(result[0]).toMatchObject({ verdict: 'unverifiable', reasons: ['directory-dependent'] });
  });

  it('reports a project without a directory as unverifiable', async () => {
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1')]), board, after, after);
    expect(result[0]).toMatchObject({ verdict: 'unverifiable', reasons: ['unresolvable'] });
  });

  it('reports a stage without a stable identity as unverifiable', async () => {
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { review: 'review-key' });
    const { runtime } = fakeRuntime();
    const result = await impact(runtime, hubOf([projectOf('p1', '/project/one')]), board, after, after);
    expect(result[0]).toMatchObject({ verdict: 'unverifiable', reasons: ['unresolvable'] });
  });

  it('reports nothing when the host has no deterministic runtime', async () => {
    const after = parseWorkflow(DEFINITION);
    const board = boardOf(DEFINITION, { wait: 'wait-key', review: 'review-key' });
    const result = await createDeterministicImpact(() => undefined).describe({ hub: hubOf([projectOf('p1', '/project/one')]), board, before: after, after });
    expect(result).toEqual([]);
  });
});
