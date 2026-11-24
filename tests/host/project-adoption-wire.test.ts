import { describe, expect, it } from 'vitest';
import { CommandSchema } from '../../src/remote.js';

describe('published project keys on the command wire', () => {
  it('accepts a project save that states a team key, including clearing it', () => {
    expect(CommandSchema.parse({ type: 'project.save', project: { name: 'API', projectPath: '/repo/api', publishedKey: 'team-api' } })).toMatchObject({ project: { publishedKey: 'team-api' } });
    expect(CommandSchema.parse({ type: 'project.save', project: { id: 'p1', name: 'API', projectPath: '/repo/api', publishedKey: '' } })).toMatchObject({ project: { publishedKey: '' } });
  });

  it('accepts ignoring and restoring a received identity', () => {
    expect(CommandSchema.parse({ type: 'project.dismiss', projectId: 'p-ops', dismissed: true })).toMatchObject({ dismissed: true });
    expect(CommandSchema.parse({ type: 'project.dismiss', hubId: 'hub', projectId: 'p-ops', dismissed: false, expectedRevision: 3 })).toMatchObject({ dismissed: false, expectedRevision: 3 });
  });

  it('refuses a dismissal without its state or with an unknown field', () => {
    expect(() => CommandSchema.parse({ type: 'project.dismiss', projectId: 'p-ops' })).toThrow();
    expect(() => CommandSchema.parse({ type: 'project.dismiss', projectId: 'p-ops', dismissed: true, extra: 1 })).toThrow();
    expect(() => CommandSchema.parse({ type: 'project.save', project: { name: 'API', projectPath: '/repo/api', published: 'x' } })).toThrow();
  });
});
