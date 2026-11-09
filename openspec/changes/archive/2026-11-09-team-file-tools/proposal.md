# Proposal

## Why

A Hub can already be bound to team storage, but the folder the team actually keeps its shared material in is invisible to agents. An agent working a task can read and edit files in the task's worktree and nowhere else, so shared specifications, decision notes, and reference documents have to be copied into a repository or pasted into a chat by hand. The storage binding already knows the team's location, so the agent surface should reach it through the same boundary the boards are published with.

## What Changes

- Add five model-facing tools: `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`. Search covers both a path/name pattern and a text pattern inside the files.
- Add one plugin-owned `team-files` directory at the root of a bound location: at the root of the plugin-managed Git clone, and in the folder selected for a local folder or a Google Drive Local binding. The directory is created on the first write and adopted when it already exists. Nothing else in the location is read, created, modified, or deleted.
- Deletion moves the file into `team-files/.trash/` under its original relative path with a timestamp suffix. The trash is invisible to every tool, is never purged by the plugin, and the plugin adds no restore action.
- Files are UTF-8 text. A binary file is refused with a typed error that names the path. Read, search, and per-line limits match the host's native tools: 2000 lines, 50 KiB of rendered output, 2000 characters per line, 100 path matches, 250 content matches.
- **BREAKING** at spec level: a local folder and a Google Drive Local folder no longer have exactly one owned entry. The plugin owns `kanban-hub.yaml` and the `team-files` directory, and still touches nothing else.
- Git reads never fetch: the clone is refreshed by the automatic publishing check, so a read can be up to one check interval behind. Git writes fetch first, refuse when the file changed on the team side since the clone was updated, and otherwise commit and push immediately. A refused push returns the clone to the fetched head, so the clone never keeps a commit the plugin did not publish.
- Google Drive Cloud keeps its document-only contract: a Hub bound to it reports team files as unsupported for that storage rather than falling back to another mechanism.
- Carry three refactorings the feature needs: a shared team-root and path-safety module, a single Git clone collaborator shared by document publishing and file writes, and a `createFileStore` capability on the storage descriptor so no service branches on the storage identifier.
- Team Settings names the `team-files` directory for a storage that supports it. No file browser, no new drawer section, no new client state.

## Capabilities

### New Capabilities

- `team-files`: the contract of the five team file tools, the directory the plugin owns in a bound location, path and content rules, per-storage behavior including Git fetch, commit, and push semantics, and serialization against document publishing.

### Modified Capabilities

- `hub-sharing`: the local folder and Google Drive Local location requirements change the owned-entry rule from one document to the document plus the `team-files` directory; disabling publishing must keep that directory; Team Settings names it.
- `product-tools`: the restricted tool surface gains the five team file tools, explicit user intent covers team file writes, and availability extends to task conversations and ordinary chats.

## Impact

- Host: `src/host/sharing` gains the file-store port, its implementations, the shared path module, and the extracted Git clone; `src/host/tools` gains the team file tools; `src/index.ts` gains the wiring.
- New typed failure codes for the team file surface, returned through the existing `KanbanError` / `Problem` shape.
- Specifications: this change adds the `team-files` capability and modifies `hub-sharing` and `product-tools`.
- Documentation: the Team Settings section and the registered-tool table in `README.md`.
- Unaffected: board, task, and note data; the published document format, which stays version 2; the Google Drive Cloud document path; every client surface beyond the one Team Settings line.
