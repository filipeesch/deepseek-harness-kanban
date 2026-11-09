import { describe, expect, it } from 'vitest';
import { allocateProjectKey, projectKeyFromName, requireProjectKey, withProjectKeys } from '../../src/domain/project-key.js';

function codeOf(run: () => void): string | undefined {
  try { run(); return undefined; }
  catch (error) { return (error as { code?: string }).code; }
}

describe('project key', () => {
  it('derives a stable key from the project name', () => {
    expect(projectKeyFromName('Platform API')).toBe('platform-api');
    expect(projectKeyFromName('  Web / App  ')).toBe('web-app');
    expect(projectKeyFromName('   ')).toBe('project');
  });

  it('allocates deterministically and suffixes a collision', () => {
    expect(allocateProjectKey('Web', [])).toBe('web');
    expect(allocateProjectKey('Web', [])).toBe(allocateProjectKey('Web', []));
    expect(allocateProjectKey('Web', ['web'])).toBe('web-2');
    expect(allocateProjectKey('Web', ['web', 'web-2'])).toBe('web-3');
  });

  it('validates and normalizes an edited key', () => {
    expect(requireProjectKey('  Platform-API ')).toBe('platform-api');
    expect(codeOf(() => requireProjectKey('bad key'))).toBe('INVALID_PROJECT_KEY');
    expect(codeOf(() => requireProjectKey(''))).toBe('INVALID_PROJECT_KEY');
    expect(codeOf(() => requireProjectKey(4))).toBe('INVALID_PROJECT_KEY');
  });

  it('backfills only the records that predate keys and never duplicates one', () => {
    const keyed = withProjectKeys([{ name: 'Web' }, { name: 'Web' }, { name: 'API', projectKey: 'web' }]);
    expect(keyed.map(project => project.projectKey)).toEqual(['web-2', 'web-3', 'web']);
  });

  it('is deterministic for the same records', () => {
    const records = [{ name: 'A' }, { name: 'B' }];
    expect(withProjectKeys(records)).toEqual(withProjectKeys(records));
  });
});
