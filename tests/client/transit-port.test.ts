import { afterEach, describe, expect, it, vi } from 'vitest';
import { supportsPathMotion } from '../../src/client/workflow-view/transit/port.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('path-motion capability', () => {
  it('reports a host that can animate along a path', () => {
    vi.stubGlobal('CSS', { supports: () => true });
    expect(supportsPathMotion()).toBe(true);
  });

  it('reports a host that cannot', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    expect(supportsPathMotion()).toBe(false);
  });

  it('treats a host with no capability probe as unable', () => {
    vi.stubGlobal('CSS', undefined);
    expect(supportsPathMotion()).toBe(false);
  });

  it('treats a throwing probe as unable', () => {
    vi.stubGlobal('CSS', { supports: () => { throw new Error('unsupported'); } });
    expect(supportsPathMotion()).toBe(false);
  });
});
