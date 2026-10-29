import { describe, expect, it } from 'vitest';
import { applyDetection, canSaveProject, createProjectDraft, editProjectDraft, toProjectInput } from '../../src/client/projects/project-draft.js';

describe('project draft detection', () => {
  it('fills pristine fields from a Git location', () => {
    const draft = createProjectDraft();
    const next = applyDetection({ ...draft, projectPath: '/repo/apps/web' }, { kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
    expect(next.gitRootPath).toBe('/repo');
    expect(next.defaultBranch).toBe('main');
    expect(next.name).toBe('web');
  });

  it('keeps a manually edited Git root while still updating a pristine branch', () => {
    const draft = editProjectDraft(createProjectDraft(), 'gitRootPath', '/custom/root');
    const next = applyDetection(draft, { kind: 'git', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
    expect(next.gitRootPath).toBe('/custom/root');
    expect(next.defaultBranch).toBe('main');
  });

  it('updates an edited field that still equals the last detected value', () => {
    const first = applyDetection(createProjectDraft(), { kind: 'git', projectPath: '/a', gitRootPath: '/one', defaultBranch: 'main' });
    const edited = editProjectDraft(first, 'gitRootPath', '/one');
    const next = applyDetection(edited, { kind: 'git', projectPath: '/a', gitRootPath: '/two', defaultBranch: 'trunk' });
    expect(next.gitRootPath).toBe('/two');
    expect(next.defaultBranch).toBe('trunk');
  });

  it('clears pristine Git fields when no repository is found', () => {
    const first = applyDetection(createProjectDraft(), { kind: 'git', projectPath: '/a', gitRootPath: '/one', defaultBranch: 'main' });
    const next = applyDetection(first, { kind: 'folder', projectPath: '/plain' });
    expect(next.gitRootPath).toBe('');
    expect(next.defaultBranch).toBe('');
  });

  it('keeps a manual name', () => {
    const draft = editProjectDraft(createProjectDraft(), 'name', 'Mine');
    expect(applyDetection(draft, { kind: 'folder', projectPath: '/plain/other' }).name).toBe('Mine');
  });
});

describe('project draft payload', () => {
  it('omits a blank Git root and a branch without a Git root', () => {
    const draft = { ...createProjectDraft(), name: 'Notes', projectPath: '/plain/notes', defaultBranch: 'main' };
    expect(toProjectInput(draft)).toEqual({ name: 'Notes', projectPath: '/plain/notes' });
  });

  it('sends the Git root and branch when both are present', () => {
    const draft = { ...createProjectDraft(), name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' };
    expect(toProjectInput(draft)).toEqual({ name: 'Web', projectPath: '/repo/apps/web', gitRootPath: '/repo', defaultBranch: 'main' });
  });

  it('requires a name and an absolute project path', () => {
    expect(canSaveProject({ ...createProjectDraft(), name: '', projectPath: '/repo' })).toBe(false);
    expect(canSaveProject({ ...createProjectDraft(), name: 'Web', projectPath: 'relative/path' })).toBe(false);
    expect(canSaveProject({ ...createProjectDraft(), name: 'Web', projectPath: '/repo' })).toBe(true);
  });
});
