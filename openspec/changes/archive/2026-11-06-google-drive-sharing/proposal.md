# Proposal

## Why

Team publishing currently requires a Git repository and the machine's Git credentials. Teams that keep their shared material in Google Drive cannot share Hub boards and workflows without adding a Git repository and a separate credential setup, so the feature is unavailable to them. Google Drive is the storage these teams already use, and it offers an account-scoped connection with change detection, which allows an opt-in automatic synchronization path alongside the existing explicit Git publishing.

## What Changes

- Add Google Drive as a team storage alongside Git. A Hub binds exactly one storage, chosen in a new **Team Settings** section (renamed from Publishing) whose content switches to the selected storage.
- Connect a Google account through an installed-app OAuth flow (system browser, loopback redirect, PKCE) and keep the authorization in the host credential store; refresh without a new sign-in; disconnect and switch accounts. Request only the Drive access required to list the selected location, read and write the Hub document, and observe changes.
- Select a folder in My Drive or a Shared Drive; the binding stores the Drive, folder, and document file IDs. The plugin creates or adopts `kanban-hub.yaml` (the same published document format), never touches other files, and never deletes the team document.
- Continuous bidirectional synchronization for Google Drive: local board and workflow saves synchronize automatically after a short debounce; team changes apply automatically when conflict-free; conflicts, blockers, and concurrent writes require explicit review; offline changes stay pending and retry; a 60-second default check uses the Drive change feed and reads the document only when its revision changed.
- Keep Git publishing explicit (Publish / Get updates) and unchanged. Add a provider registry so Git and Google Drive share the document, merge, and identity model without provider branches in the domain.
- Migrate the publishing record schema (v1 to v2) for the storage-neutral binding and provider state; existing Git-published Hubs keep working.
- Refactor the publishing service and the Publishing UI into smaller modules so authorization, synchronization, and per-storage surfaces do not grow a single service or component.

**Non-goals:** synchronizing projects, tasks, notes, conversations, worktrees, or the raw local storage tree; a backend or service account; the `drive.file` plus Picker model; automatic synchronization for Git; multiple Google accounts on one installation; deleting the team document when a Hub is disconnected or deleted.

## Capabilities

### New Capabilities

- None. The change extends the existing `hub-sharing` capability and adjusts two existing capability requirements.

### Modified Capabilities

- `hub-sharing`: the storage-provider boundary now includes Google Drive; a new Team Settings interface with a storage selector; the Google Drive connection and location; continuous synchronization with offline pending changes and conflict review; change-feed-based checks; first connection across both storages; provider-specific concurrency guarantees.
- `hubs`: Hub deletion removes the binding and any plugin-managed local workspace, and leaves the team's shared document untouched for both storages.
- `kanban-board`: a team-wide board removal is included in the next synchronization, explicitly for Git and automatically for Google Drive.

## Impact

- Host: `src/host/sharing/store.ts`, `state.ts`, `service.ts`, `view.ts`, `scheduler.ts`, and `git-store.ts` (neutral refactor); new Google Drive authorization, API client, storage adapter, and synchronization coordinator; `src/index.ts` composition and credential-service injection.
- Shared and client: `src/shared/types.ts`, `src/remote.ts` (provider, address, authorization, synchronization state, new authorization commands), `src/client/settings/*` (Team Settings, storage selector, per-storage panels), `src/client/sharing/*`, `src/client/board.tsx`, `src/client/hub-nav.tsx`.
- Dependencies: `@deepseek-ai/dsh-credentials` peer and type dependency; no new runtime HTTP dependency because the host uses `fetch`. Google Cloud OAuth client (default ID plus optional custom client), the `drive` scope, and restricted-scope verification for the published external app.
- Tests: provider contract, authorization and refresh, Drive API error mapping, change cursors, continuous synchronization (debounce, offline, conflict, restart), and browser coverage for Team Settings and the storage swap.
- Documentation: README, operations and recovery, and the `hub-sharing` spec.
