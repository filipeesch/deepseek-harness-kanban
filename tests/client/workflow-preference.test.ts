// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { WORKFLOW_VIEWPORTS_KEY, readWorkflowViewport, readWorkflowViewports, writeWorkflowViewport } from '../../src/client/workflow-preference.js';

afterEach(() => { globalThis.localStorage?.clear(); });

describe('workflow viewport preference', () => {
  it('has no stored position for a board that was never navigated', () => {
    expect(readWorkflowViewport('board-1')).toBeNull();
  });

  it('stores a position per board', () => {
    writeWorkflowViewport('a', { x: 1, y: 2, zoom: 1.5 });
    writeWorkflowViewport('b', { x: -3, y: 4, zoom: 0.5 });
    expect(readWorkflowViewport('a')).toEqual({ x: 1, y: 2, zoom: 1.5 });
    expect(readWorkflowViewport('b')).toEqual({ x: -3, y: 4, zoom: 0.5 });
  });

  it('drops a malformed entry instead of throwing', () => {
    globalThis.localStorage.setItem(WORKFLOW_VIEWPORTS_KEY, JSON.stringify({ a: { x: 1, y: 2, zoom: 1 }, b: { x: 'no', y: 2, zoom: 1 }, c: null }));
    expect(readWorkflowViewports()).toEqual({ a: { x: 1, y: 2, zoom: 1 } });
  });

  it('reads an unparsable map as empty', () => {
    globalThis.localStorage.setItem(WORKFLOW_VIEWPORTS_KEY, 'not json');
    expect(readWorkflowViewports()).toEqual({});
  });
});
