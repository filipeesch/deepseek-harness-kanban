import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../src/domain/hub-operations.js';

describe('board settings normalization', () => {
  it('trims an absolute worktree base path and clears an empty one', () => {
    expect(normalizeSettings({ worktreeBasePath: ' /trees ' })).toEqual({ worktreeBasePath: '/trees' });
    expect(normalizeSettings({ worktreeBasePath: '   ' })).toEqual({});
    expect(normalizeSettings({})).toEqual({});
  });

  it('rejects a relative path, an unknown setting, and a non-text value', () => {
    expect(() => normalizeSettings({ worktreeBasePath: 'relative/trees' })).toThrow(/absolute path/);
    expect(() => normalizeSettings({ engine: 'legacy' } as never)).toThrow(/Unsupported/);
    expect(() => normalizeSettings({ worktreeBasePath: 42 } as never)).toThrow(/text/);
    expect(() => normalizeSettings(null as never)).toThrow(/mapping/);
  });
});
