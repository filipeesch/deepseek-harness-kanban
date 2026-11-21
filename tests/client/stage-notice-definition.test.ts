import { describe, expect, it } from 'vitest';
import { STAGE_NOTICE_NODE_KIND, stageNoticeDefinition } from '../../src/client/stage-notice-node.js';

function event(sourceKind = 'stage-notice', surfaceOp: 'append' | 'replace' = 'append') {
  return {
    type: 'user/message', seq: 7, time: 1_700_000_000_000, surfaceOp,
    data: { id: 'message-9', role: 'user', source: { kind: sourceKind, form: 'notice', summary: 'Stage: Review' }, content: [{ type: 'text', text: 'Stage notice: the task is now in the Review stage.' }] },
  } as never;
}

function context(): Record<string, unknown> {
  const match = stageNoticeDefinition.match(event());
  if (match === null) throw new Error('expected a stage-notice match');
  const start = { ...match, event: event(), location: { kind: 'unresolved' as const } };
  const base: Record<string, unknown> = { key: 'notice-key', kind: STAGE_NOTICE_NODE_KIND, id: 'message-9', matches: [start], start, current: new Map() };
  return { ...base, state: stageNoticeDefinition.start(base as never, start as never, {} as never) };
}

describe('stage-notice Chat node Definition', () => {
  it('claims only append-surface messages with the stage-notice source', () => {
    expect(stageNoticeDefinition.match(event())).toEqual({ id: 'message-9', role: 'start', exclusive: true });
    expect(stageNoticeDefinition.match(event('stage-instruction'))).toBeNull();
    expect(stageNoticeDefinition.match(event('user'))).toBeNull();
    expect(stageNoticeDefinition.match(event('stage-notice', 'replace'))).toBeNull();
  });

  it('builds a visible turn-level node at the injected message position with the notice form', () => {
    const node = stageNoticeDefinition.buildViewNode?.(context() as never) as unknown as Record<string, unknown>;
    expect(node).toMatchObject({ key: 'notice-key', kind: STAGE_NOTICE_NODE_KIND, id: 'message-9', target: 'chat', anchorSeq: 7, visibility: 'visible', groupTree: 'turn' });
    expect(node.data).toMatchObject({ seq: 7, producer: { role: 'inject', label: 'stage-notice' }, form: 'notice' });
  });

  it('publishes nothing without assembled state', () => {
    expect(stageNoticeDefinition.buildViewNode?.({ ...(context() as object), state: undefined } as never)).toBeNull();
  });
});
