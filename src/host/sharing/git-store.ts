import { KanbanError } from '../../shared/errors.js';
import { TEAM_FILES_DIRECTORY } from '../../shared/types.js';
import type { SharingCommandRunner } from './command-runner.js';
import { GitClone } from './git-clone.js';
import { GitLayoutStore } from './layout-git.js';
import { GitTeamFileStore } from './git-team-file-store.js';
import type { TeamFileStore } from './team-file-store.js';
import type { SharingBinding, SharingProviderDescriptor } from './provider.js';

export { SHARED_LAYOUT_FILE } from '../../domain/sharing/layout.js';
export { sharingRoot } from './root.js';
export type { SharingCommandRunner } from './command-runner.js';

/** The Git storage descriptor: explicit publish, repository address, managed clone. */
export function createGitProviderDescriptor(options: { root: string; runner?: SharingCommandRunner }): SharingProviderDescriptor {
  const cloneFor = (hubId: string, binding: SharingBinding): GitClone => {
    const repository = binding.settings.repository;
    if (!repository) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
    return new GitClone({ root: options.root, hubId, repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
  };
  return {
    id: 'git',
    label: 'Git repository',
    defaultIntervalMinutes: 5,
    requiresAuthorization: false,
    normalizeSettings(settings) {
      const repository = (settings.repository ?? '').trim();
      if (repository.length === 0 || repository.length > 2048 || /[\0\r\n]/.test(repository)) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
      return { repository };
    },
    describe(binding) { return binding.settings.repository ?? ''; },
    createLayoutStore(hubId, binding) {
      if (binding.provider !== 'git') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not supported by the Git provider.', { provider: binding.provider });
      const repository = binding.settings.repository;
      if (!repository) throw new KanbanError('INVALID_INPUT', 'A repository address is required.');
      return new GitLayoutStore({ root: options.root, hubId, repository, ...(options.runner === undefined ? {} : { runner: options.runner }) });
    },
    createFileStore(hubId, binding): TeamFileStore {
      if (binding.provider !== 'git') throw new KanbanError('SHARING_UNSUPPORTED_STORAGE', 'The configured team storage is not supported by the Git provider.', { provider: binding.provider });
      return new GitTeamFileStore({ clone: cloneFor(hubId, binding), directory: TEAM_FILES_DIRECTORY });
    },
    normalizeState(state) { return state; },
  };
}