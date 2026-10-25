# Spec Delta

## ADDED Requirements

### Requirement: Native conversation session header

In the Conversations section, the task drawer SHALL render the host's native session header for the active conversation above the native transcript and beneath the task conversation tab strip. The header SHALL use the host's native session title and ancestry, lineage control, header actions, and non-store utilities. It SHALL follow the active conversation, including a peeked subagent conversation, and SHALL update when that session's native header entries change. It SHALL NOT appear in the Info, Git, or Notes sections.

The header SHALL use the host's native components and SHALL NOT reimplement their labels, counts, popovers, lineage, or navigation. When the native session-header entry is unavailable, the drawer SHALL fall back to the host's native header-action row rather than a plugin replica. A native header entry that requires a native store instance the drawer cannot access SHALL be omitted instead of being rendered against an isolated store.

#### Scenario: Show the native session header for the active conversation

- **WHEN** the user opens the Conversations section for a task conversation
- **THEN** the drawer shows the host's native session title, ancestry, lineage control, header actions, and non-store utilities
- **AND** the header sits beneath the task conversation tab strip and above the native transcript

#### Scenario: Follow the active conversation

- **WHEN** the user switches from one task conversation tab to another or peeks a subagent conversation
- **THEN** the native session header shows the newly active session's native header entries
- **AND** native header entries from the previous or other conversations are not merged into it

#### Scenario: Keep task sections free of the header

- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the native session header is not shown

#### Scenario: Open a native header popover

- **WHEN** the user opens a native subagent, job, or other header popover
- **THEN** the native popover renders as it does in an ordinary DSH chat
- **AND** interacting with that popover does not close the task drawer

#### Scenario: Fall back without a native header entry

- **WHEN** the pinned host does not register the native session-header entry
- **THEN** the drawer shows the compact native-action row as a fallback
- **AND** it does not render a plugin-owned replica of a native label, count, or popover

#### Scenario: Omit a store-backed header entry

- **WHEN** a native header entry depends on a native store instance the drawer cannot access
- **THEN** that entry is omitted
- **AND** the drawer does not present a control backed by an isolated store that cannot affect the real native surface

### Requirement: Native agent mode selection for blank conversations

The drawer SHALL present the host's native agent-preset picker for a blank top-level task conversation. The picker SHALL select that conversation's preset through the host's native preset roster and selection behavior. It SHALL be available only while the conversation is blank; after the first turn starts, the drawer SHALL present the host's native read-only mode label for that conversation. The picker SHALL NOT appear for a started conversation or for a peeked subagent conversation.

The plugin SHALL NOT store a task-level default mode or a plugin-owned preset. Each new conversation SHALL start from the host default or the mode selected for that blank conversation. A native selection refusal SHALL be reported through the host picker's native feedback.

#### Scenario: Show the native picker on a blank task conversation

- **WHEN** a top-level task conversation has not started its first turn
- **THEN** the drawer shows the host's native agent-preset picker
- **AND** the host's native read-only mode label is not shown simultaneously

#### Scenario: Select the mode for that conversation

- **WHEN** the user selects a preset in the native picker for a blank conversation
- **THEN** the plugin invokes the host's native preset selection for that exact session
- **AND** the native session's recorded mode reflects the accepted selection

#### Scenario: Replace the picker after the first turn

- **WHEN** the task conversation starts its first turn
- **THEN** the picker is no longer shown
- **AND** the drawer shows the host's native read-only mode label for that conversation

#### Scenario: Keep the picker out of subagent peeks

- **WHEN** the active view is a peeked subagent conversation
- **THEN** the native mode picker is not shown
- **AND** the drawer does not offer a mode change for the child

#### Scenario: Do not persist a task default

- **WHEN** the user selects a mode for one blank conversation and later creates another conversation
- **THEN** the new conversation starts from the host default or its own native picker choice
- **AND** the plugin has not written a task-level mode field

### Requirement: In-drawer subagent conversation peek

Selecting a subagent row from the host's native lineage or subagent catalog in the drawer SHALL open that child conversation in place inside the task drawer rather than changing the main DSH panel. The child view SHALL use the host's native session header, transcript, and composer. The native breadcrumb/lineage SHALL navigate the child's ancestors inside the drawer, and selecting a task conversation tab SHALL exit the peek.

The peek SHALL be transient: closing the drawer, switching tasks, selecting a root tab, or leaving the Conversations section SHALL clear it. The peeked child SHALL NOT be added to the task's conversation tabs, persisted session IDs, or closed-conversation list, and the task's ownership and cleanup rules SHALL remain unchanged. A target outside the task's owned subagent lineage SHALL NOT be peeked; native DSH navigation SHALL remain in effect for it.

The child view SHALL reuse the host's native composer election: a one-shot child SHALL be read-only, and a continuable child SHALL retain native follow-up and parent-offline behavior.

#### Scenario: Open a subagent in the drawer

- **WHEN** the user selects a subagent row from the active conversation's native lineage or subagent catalog
- **THEN** the child conversation replaces the active transcript inside the task drawer
- **AND** the main DSH panel does not change away from the Kanban board

#### Scenario: Navigate back with the native breadcrumb

- **WHEN** the user activates a parent or root ancestor in the child's native breadcrumb/lineage
- **THEN** the drawer shows that ancestor conversation in place
- **AND** the task tab strip remains the root-session surface

#### Scenario: Exit the peek from a task tab

- **WHEN** the user selects a task conversation tab while a subagent peek is active
- **THEN** the drawer shows that task conversation and clears the peek

#### Scenario: Reset the peek

- **WHEN** the user closes the drawer, switches tasks, or leaves the Conversations section while a peek is active
- **THEN** the next Conversations view does not reopen the peeked child
- **AND** the active root conversation is the starting surface

#### Scenario: Keep the child out of task persistence

- **WHEN** the user peeks a subagent conversation
- **THEN** the child is not added to the task's session IDs, conversation tabs, or closed-conversation list
- **AND** the task's ownership and cleanup behavior is unchanged

#### Scenario: Use the native child composer

- **WHEN** the peeked child is a one-shot subagent
- **THEN** its composer is the native read-only composer
- **AND** when the child is continuable, the native follow-up and parent-offline behavior remains available

#### Scenario: Leave foreign navigation to the host

- **WHEN** a subagent navigation target is not an owned descendant of a task conversation
- **THEN** the plugin does not open it as a drawer peek
- **AND** the host's native DSH navigation remains in effect

### Requirement: Native conversation header host without a DSH change

The plugin SHALL render the host's native session-header, lineage, header-action, and non-store utility components in the drawer. It SHALL NOT reimplement their labels, counts, popovers, lineage, navigation, or mode display, and SHALL NOT require a DSH patch or a new DSH release for this surface. The host integration SHALL be compatible with the pinned DSH release and SHALL guard every native entry it reads.

#### Scenario: Render the host's native components

- **WHEN** the pinned DSH host registers the native session-header and child entries
- **THEN** the drawer renders those native components rather than plugin replicas
- **AND** their native popovers, navigation, and actions remain available

#### Scenario: Guard missing native entries

- **WHEN** an expected native entry is unavailable
- **THEN** the drawer omits or falls back for that entry without crashing the Conversations section
- **AND** it does not invent a plugin-owned replacement for that native component

#### Scenario: Stay on the pinned host

- **WHEN** the plugin is installed on its pinned DSH release
- **THEN** the native session-header host works without a DSH patch or a new DSH release
- **AND** the plugin does not claim support for a different host layout

## MODIFIED Requirements

### Requirement: Reuse the native DSH conversation experience

Task conversation tabs and their peeked subagent conversations SHALL reuse the native DSH session header, chat transcript, composer, and execution rather than introducing a replacement shell or agent runtime. Embedding those conversations in a drawer SHALL preserve the host's applicable tools, execution, permissions, mode selection, and native subagent navigation behavior.

#### Scenario: Render the native conversation surface

- **WHEN** a user opens a task conversation in the drawer
- **THEN** the drawer presents the host's native session header, transcript, and composer
- **AND** it does not present a plugin-owned replacement for those native components

#### Scenario: Use native chat inside a task tab

- **WHEN** a user sends a message through a task's embedded native conversation
- **THEN** the request is handled as a native DSH conversation turn subject to the host's applicable execution and permission behavior

### Requirement: First-turn task context

The plugin SHALL inject a durable task-context message into the first model step of a task conversation before the first user message. The context SHALL contain the task title, task identifier, description, and workflow stage at first contact. The message SHALL be a plugin-sourced native message, SHALL NOT be a user-authored chat message or a system prompt, and SHALL NOT start a turn.

The conversation SHALL present the context as an inline visible context row using the host's native context-row presentation. If that presentation is unavailable, an inline fallback row SHALL preserve the context text. The row SHALL be part of the transcript flow, SHALL appear at the injected message's position, and SHALL scroll with the transcript rather than remaining fixed over it. It SHALL be visible wherever the task conversation is rendered, including the drawer and ordinary native DSH chat. The context SHALL be injected at most once per conversation; later turns and stage instructions SHALL NOT repeat it. Each new conversation SHALL receive its own first-turn context. A conversation with existing user messages SHALL NOT receive a new first-turn context, and conversations whose first message predates this behavior SHALL NOT be backfilled.

#### Scenario: First question in the initial column

- **WHEN** the user sends the first message in a task conversation while the task is in the initial stage
- **THEN** the first model request contains the injected task-context message before the user's message
- **AND** the conversation shows the inline context row at the injected message's position
- **AND** the user's message contains only the text the user sent
- **AND** the task-context message does not start a turn

#### Scenario: First stage instruction in a blank conversation

- **WHEN** a stage instruction is sent or inserted as the first message of a task conversation
- **THEN** the first model request contains the injected task-context message before the instruction
- **AND** the instruction message contains only the stage instruction
- **AND** the context row is visible in the conversation

#### Scenario: Scroll with the transcript

- **WHEN** the user scrolls the conversation containing the task-context row
- **THEN** the row moves with the transcript content
- **AND** it does not remain pinned over the transcript

#### Scenario: Visible in ordinary native chat

- **WHEN** a task conversation containing the injected task context is opened in ordinary native DSH chat
- **THEN** the inline context row is visible there as well
- **AND** the presentation is the same as in the drawer

#### Scenario: Later stage instruction

- **WHEN** the user runs or sends a stage instruction after the conversation's first message
- **THEN** the instruction is sent without repeating the task context
- **AND** the task-context row is not added again

#### Scenario: New conversation after an existing one

- **WHEN** the user creates another task conversation and sends its first message
- **THEN** that conversation receives its own first-turn task-context message
- **AND** the existing conversation is unchanged

#### Scenario: Resume a conversation with history

- **WHEN** a task conversation whose first message already exists is resumed
- **THEN** no new task-context message is injected
- **AND** the durable history and existing context row remain

### Requirement: Native conversation lineage

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations.

A subagent descendant MAY be retained transiently and displayed as an in-drawer peek. That transient reference SHALL NOT be recorded as a task session ID, tab, or closed-conversation entry, and SHALL be released when the peek ends. Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A session forked from a task conversation or from a subagent descendant SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: An in-drawer peek does not persist the child

- **WHEN** the user peeks a native subagent descendant and then leaves the peek
- **THEN** the child's transient reference is released
- **AND** the task's conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: A direct or nested subagent descendant is owned

- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: A fork remains foreign

- **WHEN** a session was forked from a task conversation but its header does not record `origin: subagent`
- **THEN** the plugin does not treat the fork as an owned descendant

#### Scenario: Archiving a parent gates its descendants

- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes

## REMOVED Requirements

### Requirement: Native conversation status row

**Reason**: Replaced by the native conversation session header, which contains the native title, ancestry, lineage, actions, and utilities rather than a separate compact row.

**Migration**: Use the native session header host; the compact native-action row remains only as a fallback when the native header entry is unavailable.

### Requirement: Read-only agent mode

**Reason**: The drawer now offers the host's native mode picker for blank task conversations; mode is read-only only after the conversation starts.

**Migration**: Render the host's native agent-preset picker for blank conversations and the native read-only label for started conversations. Do not store a plugin mode default.

### Requirement: Native status actions without a DSH change

**Reason**: Replaced by the native conversation header host, which hosts the native session header and its child entries under the same pinned-host discipline.

**Migration**: Use the native session-header host and the guarded native-entry fallback described in the new requirements.
