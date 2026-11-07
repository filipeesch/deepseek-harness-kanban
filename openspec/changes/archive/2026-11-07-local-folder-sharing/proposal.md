# Proposal

## Why

Sharing a Hub's boards and workflows requires either a Git repository and the machine's Git credentials or a Google account authorized through OAuth. Teams that already keep their shared material in a folder synchronized by a desktop client (Google Drive for desktop, OneDrive, Dropbox, or any other) have neither: they cannot share a Hub without adopting one of the two existing storages and the account or credential setup it implies. That folder is the storage these teams already operate, so it should be a first-class team storage.

## What Changes

- Add **Local folder** as a team storage alongside Git and Google Drive. A Hub still binds exactly one storage, selected in **Team Settings**; the storage selector gains a third option and renders that storage's surface.
- Connect a Hub to an existing, writable directory chosen by path or by the existing directory picker. The plugin owns one file in it, `kanban-hub.yaml`, using the same published document format as every other storage, and never reads, modifies, or deletes any other file. A Hub binds at most one folder, and a folder binds at most one Hub.
- Suggest `~/.dsh-kanban/<hubId>` as the default folder, pre-filled in the field. Connecting to exactly that suggested path creates it; any other path must already exist. The suggested path is derived from the operating-system home directory and never creates a directory until the user connects.
- Continuous bidirectional synchronization for a local folder, matching Google Drive: saving a board, board name, order, or workflow marks the Hub pending and synchronizes after a short debounce; team-only changes apply automatically in one Hub transaction; conflicts, blockers, and concurrent writes require explicit review; failures leave local changes pending and retry.
- Reads and writes are plain file operations. A check compares a content token and reads the document only when a stat-based hint reports a change. A write compares the expected token, replaces the file through a temporary sibling and a rename, and verifies the written content afterwards. The plugin does not claim an atomic conditional write, exactly as on Google Drive.
- Detect synchronization-conflict copies created by the desktop client in the bound folder and present the Hub for review instead of choosing a version silently.
- Keep Git explicit (Publish / Get updates) and unchanged. Move the provider-specific rules that the sharing service and the client panels currently hard-code into the storage descriptor, so a third storage does not add branches to the service, the view, or the settings component.
- Refactor the per-storage Team Settings panels into one shared connection surface plus a per-storage connection form, and extract the duplicated verified-write and remote-read sequences shared with Google Drive.

**Non-goals:** synchronizing projects, tasks, notes, conversations, worktrees, Hub names, or the raw local storage tree; a general file-sync engine, a watcher, or replacing the desktop client; several folders per Hub or several Hubs per folder; creating arbitrary typed paths; automatic synchronization for Git; deleting the folder or the team document when a Hub is disconnected or deleted.

## Capabilities

### New Capabilities

- None. The change extends the existing `hub-sharing` capability and adjusts two existing capability requirements.

### Modified Capabilities

- `hub-sharing`: the storage-provider boundary now includes a local folder and states its weaker write guarantee; a third option in the Team Settings storage selector with its own connection surface; local folder location and validation rules, including the suggested default path, the refusal cases, and conflict-copy review; continuous synchronization applies to the local folder; the automatic-check defaults and the read-only-when-changed rule cover a folder binding; first connection covers an empty and a non-empty folder.
- `hubs`: deleting a Hub removes the binding, leaves the team document untouched for all three storages, and removes a managed local workspace only for the storage that owns one.
- `kanban-board`: a team-wide board removal is included in the next synchronization, explicitly for Git and automatically for both continuous storages.

## Impact

- Host: new `src/host/sharing/local-folder-store.ts` (store, path normalization and validation, conflict-copy detection, provider descriptor); `src/host/sharing/provider.ts` (descriptor capabilities and the single storage identifier source), `state.ts` (binding schema and record migration), `service.ts` (descriptor-driven connect rules and a shared remote read), `view.ts` (capability-driven authorization, document-level blockers), and `src/index.ts` (registry composition). No managed workspace, no credential, and no network dependency.
- Shared and client: `src/shared/types.ts` and `src/remote.ts` (third storage identifier, document-level blockers); `src/client/settings/team-settings/*` (selector, panel registry, shared connection and connected surfaces); reuse of `src/client/directory-picker.ts` for browsing.
- Tests: provider contract for path validation, read, write, verified write, conflict-copy detection, and a no-op destroy; service coverage for the suggested-path creation rule, duplicate-folder refusal, and the preview flow; view coverage for the document-level review; browser coverage for the third storage in the selector.
- Documentation: README Team Settings, the operations and recovery notes, and the `hub-sharing` spec.
