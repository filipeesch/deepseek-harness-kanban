# Proposal

## Why

Teams that already run Google Drive for desktop already have their shared folder mounted on the machine, but today the only Drive storage needs an OAuth account and the Drive API, while the local-folder storage makes the user type or hunt for a path that Google controls, localizes, and can remount. A first-class **Google Drive Local** storage closes that gap: it discovers the installed app's mounts on macOS and Windows, lets the user browse and pick a folder in the UI, and synchronizes `kanban-hub.yaml` through the existing filesystem engine — no account, no API, no manual path.

## What Changes

- Add a fourth team storage, **Google Drive Local** (`google-drive-local`), with continuous synchronization over one folder inside a discovered Google Drive mount. The document format, merge rules, and Hub states do not change.
- Discover mounts locally: macOS (`~/Library/CloudStorage`, `com.google.drivefs.settings`, legacy `/Volumes`) and Windows (`HKCU\Software\Google\DriveFS` plus volume validation). Never assume a fixed path, volume name, or drive letter.
- Add a folder picker modal: discovered accounts/mounts, breadcrumb, folder list, current-level filter, a `kanban-hub.yaml` adopt-versus-create hint, and the host's native directory picker as an always-available fallback. The connection surface never asks for a typed path.
- Require the selected folder to resolve inside a discovered Drive mount at connect time; when the mount or the folder disappears afterwards, present a typed unavailable state, keep every local change pending, and resume when it returns.
- Add a `Change folder` action to a connected Google Drive Local Hub that reopens the first-connection flow (receive the team configuration or publish the local one) while keeping boards, tasks, and notes.
- Turn the storage selector into a card grid with one icon and one description per storage, and rename the existing OAuth storage label from "Google Drive" to "Google Drive Cloud". The storage identifier `google-drive` is unchanged, so stored bindings need no migration.
- Remove Google Drive authorization from the publishing service into a dedicated coordinator, and expose local Drive discovery as a device-scoped query rather than publishing state.
- Out of scope: OAuth or Drive API usage for this storage, mounting or unmounting Drive, creating shortcuts, and any new field inside `kanban-hub.yaml`.

## Capabilities

### New Capabilities

- `google-drive-local`: local discovery and browsing of Google Drive for desktop locations — per-OS discovery sources, confined folder listing, grouping of accounts and shared drives without trusting localized names, refresh and cache behavior, typed failure states, and platforms without the app.

### Modified Capabilities

- `hub-sharing`: adds the Google Drive Local storage and its connection, location validation, `Change folder`, unavailable, and synchronization behavior; updates the supported-storage list in the provider boundary; updates the Team Settings surface to provider cards plus the new connection surface and picker; and extends automatic checks and continuous synchronization wording to cover the new storage.

## Impact

- **Host**: `src/host/sharing/` gains a `google-drive-local/` module (platform adapters, discovery, browsing, descriptor) and an authorization coordinator; `service.ts`, `provider.ts`, `state.ts`, `view.ts`, `store.ts` and `index.ts` change; the controller/app expose one new device-scoped query.
- **Shared types and remote**: `SHARING_STORAGES`, new discovery result types, a new `sharing.changeLocation` command, and a new `kanban/localDrive` remote method with its schema and client bridge. The host snapshot schema is unchanged.
- **Client**: storage selector becomes a card grid with provider icons; new Google Drive Local panel and folder-picker modal; new stroke icons; existing publishing browser tests that select the storage by native `<select>` must change.
- **Data**: no record migration. A Drive Local binding stores the resolved folder path plus display-only mount metadata; the path remains the identity.
- **Dependencies and runtime**: none added; the host reads the Windows registry and macOS preferences through its injected command runner, and performs no network call.
- **Docs and tests**: existing `hub-sharing` spec updated, new `google-drive-local` spec, host tests per platform adapter and for the picker-facing query, a browser test with a faked local-drive query, and the Team Settings section of `README.md`.
