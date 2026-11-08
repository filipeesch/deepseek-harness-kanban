# Spec Delta

## ADDED Requirements

### Requirement: Native conversation window in the task drawer

In the Conversations section, the task drawer SHALL render one occurrence of the host's public native conversation window for the active task conversation instead of assembling the conversation chrome itself. The occurrence SHALL use the embedded variant and SHALL take its Session from the retained Session area that wraps it; the plugin SHALL NOT pass a Session identity as an occurrence prop.

The host window SHALL compose the complete native surface: the Session header — title ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner — and the conversation body — the active View, transcript, composer, and Session statistics, including the composer statistics footer. The drawer SHALL NOT mount, register, or fabricate any header component, header input, View roster, or pin state. Contributions registered by the host and its plugins SHALL render through the window without per-occurrence registration. The drawer MAY render its own agent-preset card picker outside the window, as defined by Agent-preset cards start task conversations.

View facts SHALL remain per-Session and shared with the main panel: the View roster, unpinned View choices, the active View, and the composer draft SHALL NOT be duplicated by the drawer occurrence. The body SHALL use the View selected for that Session; the plugin SHALL NOT force a View or a conversation phase. An embedded occurrence SHALL omit the leading global-navigation seat and the application window-drag marker, and SHALL NOT inherit the main conversation column's frame clearance.

The drawer SHALL keep the conversation-surface gates around the occurrence: it SHALL track the displayed conversation for read state, SHALL refuse to mount a second live composer for a Session that already has one, and SHALL report an open failure with the close action available. A header contribution that fails SHALL be reported and contained by the host's slot composition; the drawer SHALL NOT substitute a plugin-owned header or fallback row.

The window SHALL follow the active task conversation tab, including switching between root conversations, and SHALL NOT appear in the Info, Git, or Notes sections.

#### Scenario: Show the native window for the active conversation

- **WHEN** the user opens the Conversations section for a task conversation
- **THEN** the drawer renders the host's native conversation window
- **AND** the window shows the Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner
- **AND** the window shows the transcript, composer, and Session statistics footer

#### Scenario: Bind the Session from the retained area

- **WHEN** the drawer renders the window occurrence for a retained root conversation
- **THEN** the occurrence renders that Session's window without receiving a Session identity in its props

#### Scenario: Render the host header extension points

- **WHEN** a host plugin has registered an entry in a header action, utility, View More, or corner extension point
- **THEN** that entry renders in the drawer's window through the host composition
- **AND** the plugin registers no second copy of that entry for the drawer

#### Scenario: Share Views with the main panel

- **WHEN** the user selects a View tab in the drawer's window and the main panel shows the same Session
- **THEN** the main panel shows that View selected as well
- **AND** the drawer mounts no second View roster or stored selection

#### Scenario: Keep the selected View

- **WHEN** the user opens a task conversation whose Session has a selected View other than Chat
- **THEN** the drawer renders that View
- **AND** the plugin does not force the Chat View

#### Scenario: Contain a failing header contribution

- **WHEN** a host header contribution throws while the drawer's window renders
- **THEN** the host composition reports the failure and retires that contribution
- **AND** the rest of the window keeps rendering
- **AND** the drawer does not replace the header with a plugin-owned fallback

#### Scenario: Keep task sections free of the window

- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the conversation window is not shown

### Requirement: Host compatibility for the conversation window

The client SHALL render the public `conversation.window` occurrence when the running host declares it. When the Factory is not declared, the drawer SHALL present an explicit notice that the DSH version must be updated and SHALL NOT render a blank conversation area, a manually assembled header, or a plugin-owned replica of the window. The plugin SHALL remain installable on the pinned host generation and SHALL NOT require a DSH patch. The manifest pin to the release that declares the Factory is a release-time follow-up; the pinned SDK compiles the window call through a local type bridge only.

#### Scenario: Render on a supported host

- **WHEN** the plugin runs on a DSH host that declares `conversation.window`
- **THEN** the drawer renders the host window without a DSH patch

#### Scenario: Report an unsupported host

- **WHEN** the running DSH host does not declare `conversation.window`
- **THEN** the drawer presents an explicit notice that the DSH version must be updated
- **AND** it does not present an empty conversation area as if the conversation were unavailable

#### Scenario: Do not resurrect the manual header

- **WHEN** the Factory is unavailable
- **THEN** the drawer does not fall back to a hand-assembled native header or a plugin-owned header replica

### Requirement: Close the active conversation from its tab

The Conversations section SHALL present the close action for the active task conversation inside that conversation's tab, to the right of its title. The action SHALL be a control separate from the tab's selection target and SHALL NOT change the selected conversation when activated. It SHALL close the active root conversation and SHALL be disabled while a conversation command is pending. Its accessible name SHALL identify the conversation being closed.

The action SHALL remain reachable while the native conversation body is loading or has failed to open, so that the tab can still be closed. Closing SHALL only hide the conversation from the open-tab strip; it SHALL NOT archive the native session, delete its history, or change the task's session identifiers.

#### Scenario: Close the active conversation

- **WHEN** the user activates the close action in the active conversation's tab
- **THEN** that conversation moves to the closed state
- **AND** its native session and history remain
- **AND** the drawer selects the next open conversation or presents the all-closed empty state

#### Scenario: Keep the selection unchanged

- **WHEN** the user activates the close action inside the active tab
- **THEN** the close action does not first select a different conversation
- **AND** the tab's own selection target remains separate from the close control

#### Scenario: Show the close action only on the active tab

- **WHEN** the task has several open conversation tabs
- **THEN** only the active conversation's tab presents the close action

#### Scenario: Keep the close action available when the native body fails

- **WHEN** the active conversation's native body is loading or fails to open
- **THEN** the close action remains available in the conversation tab
- **AND** activating it closes the conversation rather than trapping the user in the failed view

#### Scenario: Disable the close action while a command is pending

- **WHEN** a conversation close, reopen, or create command is pending
- **THEN** the close action is disabled
- **AND** it becomes available again when the command settles

### Requirement: Agent-preset cards start task conversations

In the Conversations section, when the task has no open conversation, or when the user requests a new conversation with the plus action, the drawer SHALL present the host's native agent-preset roster as selectable cards in the conversation area. The cards SHALL replace the standalone start-conversation button. Activating a card SHALL create a native conversation for the task, select that preset on the created session through the host's native preset selection, and open that conversation.

The roster SHALL use the host's native preset list and selection behavior, excluding presets the native picker would hide: broken presets, and coding-tools-gated presets while developer tools are disabled. The plugin SHALL NOT store a task-level default mode or own a preset.

When the preset selection fails after the conversation was created, the conversation SHALL remain open with the host default, the drawer SHALL report the failure in the conversation area, and the card choice SHALL remain available to retry the selection on that same conversation. A failed roster load SHALL be reported with a retry action. Canceling the plus action's choice SHALL create no conversation; selecting another conversation tab SHALL discard the choice. The drawer SHALL NOT depend on the host's own blank-conversation preset seat or read-only mode label, which remain host-owned and may be absent outside the main panel.

#### Scenario: Show the preset cards for a task without conversations

- **WHEN** the user opens the Conversations section for a task with no open conversation
- **THEN** the drawer shows the host's agent-preset roster as selectable cards in the conversation area
- **AND** it does not show a standalone start-conversation button

#### Scenario: Start a conversation from a card

- **WHEN** the user activates a preset card for a task with no open conversation
- **THEN** a native conversation is created for the task
- **AND** the chosen preset is selected on that conversation through the host's preset selection
- **AND** the drawer opens that conversation's window

#### Scenario: Open the preset choice from the plus action

- **WHEN** the task already has an open conversation and the user activates the plus action
- **THEN** the drawer presents the preset cards in the conversation area
- **AND** activating a card creates another native conversation with that preset and opens it

#### Scenario: Keep the conversation after a preset selection failure

- **WHEN** the preset selection fails after the conversation was created from a card
- **THEN** the conversation remains open with the host default preset
- **AND** the drawer reports the failure in the conversation area
- **AND** the card choice remains available to retry the selection on that same conversation

#### Scenario: Cancel the plus action's choice

- **WHEN** the user cancels the preset choice opened from the plus action
- **THEN** no conversation is created
- **AND** the previously active conversation remains displayed

#### Scenario: Report a roster failure with retry

- **WHEN** the host's agent-preset roster cannot be loaded
- **THEN** the drawer reports the failure in the conversation area
- **AND** it offers a retry action

#### Scenario: Do not persist a task default

- **WHEN** the user starts conversations with different card choices
- **THEN** each conversation uses the preset selected for it
- **AND** the plugin has not written a task-level mode field

### Requirement: Task conversation lineage and ownership

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. A top-level conversation session SHALL include a conversation created for the task and a fork the task adopted. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations.

Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A fork the plugin has not adopted — including a fork of a subagent descendant and a fork of a session that no task retains — SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: A direct or nested subagent descendant is owned

- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: An adopted fork is a top-level task conversation

- **WHEN** the plugin has adopted a fork of a task conversation
- **THEN** the fork is one of the task's retained top-level conversation sessions
- **AND** it is owned for lineage, task deletion, and shared-worktree protection

#### Scenario: A fork remains foreign

- **WHEN** a fork was created from a subagent descendant or from a session that no task retains
- **THEN** the plugin does not treat the fork as an owned descendant or conversation

#### Scenario: Archiving a parent gates its descendants

- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes

### Requirement: Warm task conversation surfaces within the open drawer

While a task drawer remains mounted, a conversation tab that has been opened SHALL remain retained when the user switches conversation tabs or moves between the Conversations, Info, Git, and Notes sections. Returning to a visited conversation within that drawer SHALL present the same native Session and its already-open history without re-opening the Session or downloading its history again. Warm retention SHALL start lazily at each conversation's first visit; a tab that was never opened SHALL NOT open its Session in the background. Closing the task drawer or closing the conversation tab SHALL release that retained conversation. Warm retention SHALL NOT acknowledge a settled turn for a conversation whose content is not visible.

#### Scenario: Return to a visited conversation tab

- **WHEN** the user switches from one task conversation tab to another and then back to the first
- **THEN** the first tab presents the same native Session and its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Return from another drawer section

- **WHEN** the user opens a task conversation, moves to Info, Git, or Notes, and returns to Conversations
- **THEN** the previously active conversation is presented with its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Warm lazily on first visit

- **WHEN** a task has several open conversation tabs and the user has visited only one of them
- **THEN** only the visited conversation is retained while the drawer remains mounted
- **AND** an unvisited tab opens its Session when the user selects it

#### Scenario: Release on drawer close

- **WHEN** the user closes the task drawer and later reopens the task
- **THEN** the task still provides its existing conversation sessions and histories
- **AND** the conversations are acquired again for the reopened drawer

#### Scenario: Release on tab close

- **WHEN** the user closes a visited conversation tab and later reopens it from the closed-conversation list
- **THEN** the reopened conversation keeps the same native Session identity and history
- **AND** its content is acquired again when it becomes active

#### Scenario: Keep an unread turn while warm but not visible

- **WHEN** a retained conversation is not visible because another drawer section is open and its turn settles
- **THEN** the conversation's unread or failure indicator remains
- **AND** the hidden content does not acknowledge the settled turn

## MODIFIED Requirements

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that precedes a task's first execution, or by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance. When the execution preparation creates the first conversation, it SHALL do so after the worktree choice is resolved and before the move or run action is applied. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset; conversations created by the execution preparation or a stage instruction use the host default.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Start the first conversation

- **WHEN** the user selects a preset card as the first conversation's start action
- **THEN** a native DSH conversation tab is added
- **AND** the card's preset is selected on that conversation
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation

- **WHEN** the user selects the plus action in a task that already has a conversation and then selects a preset card
- **THEN** a new native DSH conversation is added as another tab associated with that same task
- **AND** the card's preset is selected on that conversation

#### Scenario: Prepare the first conversation

- **WHEN** an execution preparation runs for a task that has no conversation
- **THEN** the first native DSH conversation is created after the worktree choice is resolved
- **AND** it is created before the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: A stage instruction creates the first conversation

- **WHEN** a stage instruction needs a conversation, the task has no open conversation, and no execution preparation applies, for example a dispatched confirmed transition or an automatic advance
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: An automatic advance creates the first conversation

- **WHEN** an automatic advance needs a conversation and the task has no open conversation
- **THEN** one native DSH conversation is created
- **AND** the destination instruction is sent to it

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

### Requirement: Reuse the native DSH conversation experience

Task conversation tabs SHALL render the host's public native conversation window — its Session header, View tabs, transcript, composer, Session statistics, and execution — rather than introducing a replacement shell or agent runtime. Embedding the window in a drawer SHALL preserve the host's applicable tools, execution, permissions, mode selection, View selection, and native subagent navigation behavior.

#### Scenario: Render the native conversation surface

- **WHEN** a user opens a task conversation in the drawer
- **THEN** the drawer presents the host's native conversation window
- **AND** it does not present a plugin-owned replacement for the header, transcript, or composer

#### Scenario: Use native chat inside a task tab

- **WHEN** a user sends a message through a task's embedded native conversation
- **THEN** the request is handled as a native DSH conversation turn subject to the host's applicable execution and permission behavior

#### Scenario: Follow native subagent navigation

- **WHEN** the user selects a subagent in the window's native lineage or subagent catalog
- **THEN** the host's native DSH navigation applies
- **AND** the plugin does not open a drawer-local subagent peek

### Requirement: Immediate native conversation opening

Opening a task conversation SHALL present the host's native conversation window without waiting for a Session-catalog refresh or for history opening to settle. The drawer SHALL acquire the native Session and present the hosted window and the conversation close action immediately; history settling SHALL be presented through the host window's native settling state rather than a plugin-owned blocking placeholder. A Session-catalog refresh SHALL be attempted only when the requested Session is unknown to the client catalog, and SHALL be attempted at most once per opening attempt before a failure is reported. A failed history or session opening SHALL be reported by the drawer with the close action available.

#### Scenario: Open a conversation that is already open in DSH

- **WHEN** a user opens a task conversation whose native Session is already open in the DSH main panel
- **THEN** the drawer presents the hosted conversation window immediately
- **AND** it does not acquire the session through a Session-catalog refresh
- **AND** it does not make the history wait again before presenting the conversation

#### Scenario: Open a conversation that is not open anywhere

- **WHEN** a user opens a task conversation that no DSH surface has open
- **THEN** the drawer presents the hosted window and the host's native settling state immediately
- **AND** the transcript is presented when history settles
- **AND** the conversation tab and close action remain available while history settles

#### Scenario: Open a Session missing from the client catalog

- **WHEN** a requested task Session is unknown to the client catalog
- **THEN** the drawer refreshes the catalog once and acquires the Session
- **AND** it presents the hosted conversation window instead of an indefinite placeholder
- **AND** if the Session still cannot be acquired, the failure is reported without trapping the conversation tab

#### Scenario: Close a conversation whose history failed

- **WHEN** the native conversation reports that its history could not open
- **THEN** the drawer reports the failure in the conversation area
- **AND** the conversation's close action remains available in its tab

## REMOVED Requirements

### Requirement: Native conversation session header

**Reason**: The host now composes the whole window, including the strict Session header. Keeping a plugin-assembled header preserves a version-coupled private integration that already broke when the host added mandatory header shares and a fifth child slot.

**Migration**: Render the public embedded `conversation.window` occurrence described by "Native conversation window in the task drawer"; header content, View tabs, actions, utilities, and the corner come from host registrations.

### Requirement: Native conversation header host without a DSH change

**Reason**: The new integration deliberately requires a DSH release that declares the public window; the manual host and its fallbacks are removed.

**Migration**: Upgrade DSH to a release that declares `conversation.window`; see "Host compatibility for the conversation window".

### Requirement: In-drawer subagent conversation peek

**Reason**: The window header belongs to the host, and its lineage and subagent-catalog callbacks use the host's native Session navigation. The plugin can no longer redirect a header selection into the drawer without rebuilding the header, which is exactly what this change removes.

**Migration**: Use the native lineage or subagent catalog; native DSH navigation selects the session, and the task conversation tabs continue to represent only root conversations.

### Requirement: Close the active conversation from its session header

**Reason**: The plugin no longer renders a header row, so it has no trailing seat in the native chrome. Keeping the action in the header would require registering a global header entry that would also render in every other window occurrence.

**Migration**: Use "Close the active conversation from its tab".

### Requirement: Native agent mode selection for blank conversations

**Reason**: The host's preset seat and read-only label self-hide outside `mainView`, so the public window cannot offer preset selection in a drawer-only conversation. The plugin replaces that selection with the card picker.

**Migration**: Use "Agent-preset cards start task conversations"; no task-level default or plugin-owned preset is introduced.

### Requirement: Native conversation lineage

**Reason**: The requirement mixed ownership rules with the removed in-drawer peek. The ownership rules remain, without the transient child reference.

**Migration**: Use "Task conversation lineage and ownership"; subagent descendants remain non-tabs and non-persisted.

### Requirement: Warm conversation surfaces within the open task drawer

**Reason**: The requirement referenced and defined the removed subagent peek. The warm-retention behavior remains, unchanged except for that reference.

**Migration**: Use "Warm task conversation surfaces within the open drawer".
