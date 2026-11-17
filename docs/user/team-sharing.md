# Team Sharing

Team sharing is optional and applies per Hub. **Configuration → Team Settings** presents **Connection**, where the Hub binds one storage, and **Changes**, where the boards that differ from the team are listed. **Changes** is offered only once the Hub is bound, because a Hub with no binding publishes nothing.

While the Hub has no binding, Connection presents four storage cards, each with an icon and a one-line description: **Git repository**, **Google Drive Cloud**, **Google Drive Local**, and **Local folder**, with the chosen storage's surface below them. Once bound, Connection shows a **Status** group (storage, location, account, last check, effective interval) and a **Management** group (refresh, switch account, disconnect, and the editable interval) without a selector; changing the storage requires **Disconnect**.

Sharing state appears in the host snapshot: the Hub tab and each board tab show how many boards are waiting in each direction, and the active board presents a banner that offers **Publish board** when it has local changes, **Get updates** when the team changed it, and a link to the review when it needs a choice.

## Drafts, publishing, and updates

Saving a board, workflow, name, project scope, or board order changes only local state and marks that board as a **draft**. The workflow editor offers **Save workflow** and **Save and share**; the share action publishes that board, and a share that fails leaves the local save in place and reports the failure.

**Publish** appends what that board changed to its own log, and **Publish all** does the same for every board with local changes. Publishing a board is unavailable while that board has team changes that have not been applied: **Get updates** is the action it requires.

A team update touches only the version this installation last applied, so a board that also has local changes keeps them and remains a draft. A rename or a project-scope change is an ordinary draft of that board, and so is a change to the board order.

The Hub checks its storage automatically: every five minutes by default for Git and every minute for Google Drive Cloud, Google Drive Local, or a local folder. The interval is editable per Hub (minimum one minute; `0` disables automatic checks and leaves **Refresh**), and a check never blocks the board.

## Git repository

With Git selected, the section connects the active Hub to a repository. The plugin creates a managed clone under the DSH data root (`$DSH_HOME/kanban/shared/<hubId>`, by default `~/.dsh/kanban/shared/<hubId>`), commits there, and never stores credentials: Git supplies them from the machine's own configuration. The clone also holds a `team-files/` directory, which is where the team documents the agent tools work on live. Without a connection, no clone, check, or sharing state exists and the rest of the product behaves exactly as before.

Git keeps an atomic stale-write refusal: a publish that loses a race is refused, publishes nothing, and refreshes the seen document so the interface shows the team updates.

## Google Drive Cloud

With Google Drive Cloud selected, **Connect Google Drive** opens the system browser. The plugin uses an installed-application OAuth flow (loopback redirect plus PKCE), stores the authorization in the host credential store, refreshes it without another sign-in, and supports disconnecting and switching accounts. Tokens never appear in the document, snapshot, logs, or board content.

The default OAuth client id is versioned in the plugin; `DSH_GOOGLE_DRIVE_CLIENT_ID` and `DSH_GOOGLE_DRIVE_CLIENT_SECRET` override it for an organization's own Google Cloud client. The consent request asks for `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/drive`; the Drive scope is the one required to list the chosen location, read and write the Hub document, and observe changes. The client must be of type **Desktop app**.

The authorization is stored in the host credential store (`$DSH_HOME/.credentials.yaml`, mode 0600), not in an OS keychain: any process running as the same user can read it. The browser and the DSH host must run on the same machine, because the OAuth callback returns to a loopback port on the host; a remote browser cannot complete the flow.

The published external app must complete Google's restricted-scope verification before accounts outside its test list can authorize it. While the app is in Testing, refresh tokens expire after seven days; an Internal Workspace app avoids that limit but serves only the organization. The plugin attempts the token exchange without a client secret because Google's installed-app documentation marks it optional; if the client requires the public desktop secret, configure it through the same override and the failure is reported explicitly.

After authorization, choose My Drive or a Shared Drive and a folder. The binding records the Drive, folder, and file IDs; names are not used after the connection. The plugin creates the layout stamp when the folder is empty and adopts the published boards when it is not, touches no other file in the folder, and never deletes the team layout on Disconnect or Hub deletion. Drive has no directories to speak of, so each board log is a sibling file named for its board key. Team files are unavailable with this storage: the team file tools report it instead of operating. A folder already bound to another Hub is refused.

A check every minute enumerates the board logs and reads a log only when its Drive revision changed. Team changes are applied only when you choose **Get updates** for that board. A board changed on both sides keeps its local changes as a draft, a blocker or a concurrent write requires review and is never overwritten silently, and offline changes stay as drafts that survive a restart. **Refresh** retries immediately, and the section shows the check status, the per-board counts, and the current failure.

A Drive write compares the board log's head before writing and verifies the written content after writing. Google Drive provides no server-enforced conditional write, so a concurrent change can be detected but not prevented; the previous content remains in the Drive revision history, and the local changes stay pending for review.

## Google Drive Local

With **Google Drive Local** selected, the Hub publishes into a folder that the installed Google Drive for desktop application already mounts on this computer. This storage needs no Google account authorization and never calls the Google Drive API: the desktop client carries the published logs between machines, exactly like any other synchronized folder. Projects, tasks, notes, conversations, worktrees, and Hub names stay local.

The plugin discovers the mounted locations from local evidence only. On macOS it reads the File Provider accounts under `~/Library/CloudStorage`, the per-account mount points in the `com.google.drivefs.settings` preferences, and the legacy `/Volumes` mounts; on Windows it reads the configured mount point from the DriveFS registry keys and validates the volumes the system reports. No fixed path, volume name, or drive letter is assumed, and one unreadable source does not hide the others. A machine without the application, a platform without it, an account that is not mounted, and unreadable settings are reported as distinct states with a **Rescan** action.

**Choose folder** opens a browser over the discovered locations: the accounts on the left, a clickable breadcrumb and the folders of the current location on the right, a filter for the current level, and the host's native folder picker as an alternative. The browser marks whether the current folder already holds a published layout, and it shows the real folder names: My Drive and Shared Drives are grouped only when the names are recognized, and an unrecognized localized name is shown literally. The plugin never creates, modifies, or deletes anything while browsing.

Connecting requires the folder to resolve inside a discovered location. A folder outside every location, an unavailable mount, a path that is a file, a folder the plugin cannot write, a folder already bound to another Hub, and the plugin's own managed workspace are each refused with the specific condition named. The plugin creates or adopts the layout stamp and the `kanban-boards` directory in the chosen folder and owns exactly one other entry, the `team-files` directory that holds the documents the agent tools work on; it touches nothing else.

The binding records the resolved folder path plus the account and location labels for display. A folder that moves, a mount that disappears, or the application being removed turns the Hub unavailable with a typed failure, keeps every local change pending, and resumes without a new selection when the same path becomes readable again. **Change folder** is available while the Hub is connected: after a confirmation it opens the same browser and follows the first-connection choice for the new folder, keeping every local board, task, note, project, conversation, and worktree while discarding the previous board bindings.

Google Drive Local behaves exactly like a local folder: a check every minute observes each board log's last-modified time and size and reads it only when it changed, team changes are applied only when you ask for them, and a board changed on both sides keeps its local changes as a draft. A blocker, a conflict copy, or a concurrent write requires review. Offline changes stay as drafts and survive a restart. **Disconnect** removes the binding and keeps the folder, the layout stamp, every board log, every other file, and the installed application.

## Local folder

With Local folder selected, the Hub publishes into one directory on this machine. That directory is normally one that a desktop client already synchronizes: Google Drive for desktop, OneDrive, Dropbox, or any other. The plugin reads and writes the layout stamp and the `kanban-boards` directory there and owns exactly one other entry, the `team-files` directory, so the desktop client carries the layout between machines and the plugin needs no account, credential, network call, or managed workspace.

The path field is pre-filled with `~/.dsh-kanban/<hubId>`. Connecting to exactly that path creates the folder; connecting to any other path requires a folder that already exists and is writable. A path that is missing, is a file, cannot be written, is already bound to another Hub, or sits inside the plugin's own managed publishing workspace is refused with the specific condition named. The folder picker fills the field when the host provides one, and typing a path always remains available. Symlinks are resolved before the binding is stored, so two spellings of one directory cannot bind two Hubs.

A check every minute compares each board log's last-modified time and size and reads the content only when it changed; team changes are applied only when you choose **Get updates**, and a board changed on both sides keeps its local changes as a draft. A blocker or a concurrent write requires review. Offline changes stay as drafts and survive a restart. **Refresh** checks immediately.

A write compares the board log's head, writes a temporary sibling file, renames it over the log, and verifies the written content. A reader therefore sees either the previous complete log or the new one, never a partial file, but the filesystem cannot make "compare and replace" atomic against another process: the guarantee is the same as Google Drive's, not Git's atomic refusal. Because the desktop client uploads asynchronously, a change made on another machine is only visible here once the client downloads it, and two machines writing close together can produce a conflict copy.

When the client creates a conflict copy of the layout stamp or of a board log, the check reports it as a storage review that names the copies, blocks applying and publishing, and never merges, renames, deletes, or prefers a version. Decide which version is current, delete or rename the other copies in the folder, and the next check clears the review and resumes synchronization. Disconnecting, deleting the Hub, or rebinding never deletes the folder, the layout stamp, a board log, or any other file.

## Team files

Every storage that can serve team files owns one directory beside the layout stamp: `team-files/` at the root of the managed clone for Git, and `team-files/` inside the bound folder for a local folder or a Google Drive Local folder. The directory is created when the first team file is written and an existing one is adopted as it is. Google Drive Cloud cannot serve team files, so a Hub bound to it reports that condition instead.

Team files are UTF-8 text, and a byte order mark is preserved. A binary file is refused with an error that names the path. Read and search use the same bounds as the host's own tools: 2000 lines, 50 KiB of rendered output, 2000 characters per line, 100 path matches, and 250 content matches; any file larger than 8 MiB is refused before it is loaded, and a content search also stops at a 50 KiB match budget. Writing has no size limit of its own.

A search with a text pattern scans every path-matching file and returns only the paths that produced a match; a path pattern supports `*`, `?`, `[...]` classes, and `**` across directories. A team file path is always relative to the directory, uses `/`, and never contains an absolute path, a backslash, a control character, a `.` or `..` segment, or an empty segment; a name is used exactly as given, spaces included, and a symbolic link that resolves outside the directory or into the trash is refused before anything is created.

Deleting a team file moves it into `team-files/.trash/` under its original path with a timestamp suffix, so deleting the same path twice never overwrites an earlier entry. The trash is outside every tool, and the plugin never empties it: it is the recovery copy for a folder whose desktop client does not guarantee history.

On a Git binding a read never fetches. The automatic check fetches and brings the checked-out team files to the fetched head, so a read can be up to one check interval behind and the result names the commit the clone is at. A write fetches first and compares the file with the fetched remote; a difference is refused and leaves the clone holding the team's content, so reading again shows what changed. Otherwise the clone adopts the fetched head, commits, and pushes immediately, so an unrelated team change does not reject the write. A refused push returns the clone to the fetched head and reports a rollback that could not be completed, and the document publish and a team file write never run against the clone at the same time: a whole create, edit, or delete holds the Hub's lane.

The team file tools are described in [Agent tools](agent-tools.md).

## Published layout

The published layout is a layout stamp and one log per board. `kanban-hub.yaml` carries only the layout format version. Each board has one append-only log of JSON Lines — `kanban-boards/<key>.jsonl` in a folder or a Git clone, `kanban-board-<key>.jsonl` in a Google Drive Cloud folder — and the list of published boards is the logs that exist.

A log's first event establishes the board's authored workflow, and the log also carries that board's name, project scope, and position. Projects, tasks, notes, conversations, worktrees, Hub names, and settings stay on the local machine, and the board key survives renames.

A board's position is a short value ordered as text, so moving one board appends one event to that board's log. Publishing derives the events from what changed and appends them; nothing rewrites the history that is already stored. Each installation materializes the published workflow and keeps it with a cursor, so a check enumerates the logs, reads only the ones that changed, and applies only the events after its cursor. Because the log keeps every event, the publisher appends a whole-workflow event as a checkpoint once the tail grows past the supported bound, which bounds replay without rewriting or truncating the log.

A received board applies its project scope locally. A key that no local project carries becomes a placeholder project with no directory: it appears in the project registry as awaiting adoption, cannot create a task or a worktree, and is adopted through **Edit**, which asks for a project path and keeps the key. Deleting a project or a placeholder removes its key from every board of the Hub, which also removes it for the team on the next publish. Changing a project key rewrites the scopes of the same Hub in the same save, while installations that already received the board keep the key they were given.

The plugin reads the current layout version only. Upgrading from an older layout is forward-only: the Hub starts disconnected, and reconnecting publishes this Hub's boards in the current layout while the older entries stay untouched in the storage, where they are ignored. A layout or a board log written by a newer plugin version is never applied and never overwritten: an unknown layout version reports **Updates unavailable**, the Team Settings panel asks you to update the plugin, and local edits stay as drafts until it is; an unknown event stops only that board. Rolling back to a release that predates this layout requires republishing the team configuration.

A removal is an event too. When the team removes a board, that board's log gains a removal event and stays in storage, so an installation that holds the board can learn about it; an empty board disappears locally, while a board with tasks or unpublished changes stays as an **orphan** with an indicator on its board tab. An orphan can be published again as a new board with a new key, deleted locally, or reconnected automatically when the team publishes a board with the same key or the same name. A board whose log is missing is a draft, never a removal. Removing a board that belongs to the published configuration asks whether the removal applies only here or for the team; a local-only removal is not included in later updates, while a team-wide removal appends its removal event immediately.

**Disconnect** removes the binding and any plugin-managed workspace (the Git clone) and keeps every local board, workflow, task, note, project, conversation, and worktree; the Google Drive account authorization remains available to other Hubs, the installed Google Drive for desktop application is untouched, and the published layout and the bound folder are unchanged.

## Recovery

Storage failures are typed and recoverable without losing local work. [Recovery](../operations/recovery.md) lists the error conditions, the conflict-copy procedure, the refused-update path, the authorization failures, and the rollback and quarantine behavior.
