# Spec Delta

## ADDED Requirements

### Requirement: Drawer-local navigation for owned targets

While a task drawer is open, the client SHALL keep the Kanban panel selected when a native navigation targets a Session that the open task's lineage owns: one of its open top-level conversations or one of their direct or nested subagent descendants. The client SHALL observe the navigation after the host has selected the target, SHALL resolve the target against that lineage, SHALL apply the corresponding drawer outcome — select that conversation tab or open the transient peek — and SHALL re-select the Kanban panel in the same update that observed the navigation, so that the Kanban panel and the task drawer are never unmounted by it. The plugin SHALL NOT restore, clear, or otherwise change the host's main Session selection, and it SHALL NOT act when no task drawer is open.

A navigation whose target does not belong to the open task's lineage SHALL keep the host's native navigation unchanged, and the client SHALL NOT re-select the Kanban panel for it. Classification SHALL fail closed: a Session the client cannot resolve, a Session outside the lineage, a closed task conversation, and a lineage cycle SHALL all keep the native navigation. An owned navigation SHALL NOT move, close, archive, or adopt the target Session, and SHALL NOT change the task's stored conversation list, closed-conversation list, or lineage ownership.

#### Scenario: Keep the board for an owned subagent

- **WHEN** the user selects an owned subagent descendant in the drawer window's native lineage or subagent catalog
- **THEN** the Kanban panel is selected again and the task drawer remains mounted
- **AND** the descendant is presented inside the drawer instead of the main panel

#### Scenario: Keep the drawer for an owned conversation

- **WHEN** the user selects an open conversation of the task while its drawer is open, including an ancestor from the window's breadcrumb
- **THEN** that conversation becomes the active drawer tab
- **AND** the Kanban panel and the drawer remain mounted

#### Scenario: Leave a foreign target to the host

- **WHEN** the navigated Session is a conversation of another task, an ordinary DSH chat, or any Session outside the open task's lineage
- **THEN** the host's native navigation applies exactly as before
- **AND** the client does not re-select the Kanban panel

#### Scenario: Fail closed on an unresolvable target

- **WHEN** the navigated Session cannot be resolved, or its lineage cannot be walked without a cycle
- **THEN** the client does not re-select the Kanban panel
- **AND** the host's native navigation applies

#### Scenario: Keep the host selection

- **WHEN** the client re-selects the Kanban panel after an owned navigation
- **THEN** the host's main Session selection stays on the Session the navigation selected
- **AND** the plugin does not select a different Session in the main panel

#### Scenario: Do nothing without an open drawer

- **WHEN** the Kanban panel is active without an open task drawer and a native navigation happens
- **THEN** the client performs no re-selection and changes no drawer state

### Requirement: Transient subagent peek inside the task drawer

The drawer SHALL present a native navigation to an owned subagent descendant as a transient peek. The descendant's native conversation window SHALL replace the body of the active conversation, the conversation tab strip SHALL keep showing only the task's top-level conversations, and the active tab SHALL remain the task conversation from which the peek was opened. The peeked descendant SHALL be rendered through the same native window occurrence and the same conversation-surface gates as a task conversation.

A navigation to another owned descendant SHALL replace the peek, whether it comes from the window's lineage, its subagent catalog, or a nested child. A navigation to an owned top-level conversation, including the breadcrumb ancestor, SHALL end the peek and select that tab. The peek SHALL also end when the drawer closes, when another task is opened, when a top-level conversation tab is selected, when the drawer's section changes away from Conversations, and when the peeked Session is no longer available.

The peek SHALL NOT be persisted: it SHALL NOT change the task's session IDs, its closed-conversation list, its tabs, or its lineage ownership, and a reload or a reopened drawer SHALL start on a task conversation. The drawer SHALL retain the peeked Session only while the peek is shown and SHALL release it when the peek ends. The host's native composer behavior SHALL apply to the peeked descendant, including its read-only presentation for a one-shot child, and the peek SHALL NOT be acknowledged as a task conversation for task attention.

#### Scenario: Peek an owned subagent

- **WHEN** the user selects an owned subagent descendant in the drawer window's native lineage or subagent catalog
- **THEN** the drawer renders that descendant's native conversation window in place of the active conversation body
- **AND** the conversation tab strip still lists only the task's top-level conversations

#### Scenario: Return with the breadcrumb

- **WHEN** the user selects the task conversation in the peeked descendant's native breadcrumb
- **THEN** the peek ends and that conversation is the active drawer tab
- **AND** the board and the drawer remain mounted

#### Scenario: Move between descendants

- **WHEN** the user selects another owned descendant, or a nested descendant of the peeked one
- **THEN** the drawer replaces the peek with that descendant
- **AND** the active conversation tab is unchanged

#### Scenario: Peek a descendant outside the task

- **WHEN** the navigated descendant is not owned by the open task's lineage
- **THEN** the drawer does not peek it
- **AND** the host's native navigation applies

#### Scenario: Release the peek when it ends

- **WHEN** the peek ends because the drawer closed, another task was opened, a task conversation was selected, or the section changed
- **THEN** the drawer releases the descendant's retained Session
- **AND** the task's stored conversations are unchanged

#### Scenario: Do not persist the peek

- **WHEN** a task drawer with an open peek is reloaded or reopened
- **THEN** the drawer starts on a task conversation
- **AND** no descendant was added to the task's session IDs, closed-conversation list, or tabs

### Requirement: Fork claimed from the task drawer

When a native navigation caused by branching a task conversation leaves the Kanban panel for a Session the client cannot classify directly, the client SHALL refresh the session list once and re-resolve the target. When the refreshed catalog records the branch's parent as one of the open task's conversations, the client SHALL re-select the Kanban panel, SHALL ask the host to attach the fork with the adoption behavior defined by Fork adoption into the task conversation, and SHALL select the resulting conversation tab when the host reports the outcome; while that claim is pending the drawer SHALL present the task unchanged so the tab becomes active when the host reports it.

A host need not record the branch's parent, so the client SHALL also ask the host to prove the branch against the conversation the drawer was showing: the host SHALL accept it only when the branch records that conversation as its parent or inherits the start of that conversation's log, and SHALL attach it as the task's conversation in the same request. Only a proven branch SHALL re-select the Kanban panel and become the active conversation tab. A Session the host does not prove — a new chat, a branch of another conversation, a branch of a subagent descendant — SHALL attach nothing and SHALL keep the host's native navigation.

When an attach the drawer awaited fails, the client SHALL leave the task's conversations unchanged, SHALL report the failure in the drawer, and SHALL offer an action that opens the fork in the main chat. A fork created without a navigation — including the window header's session action — SHALL be adopted as defined by Fork adoption into the task conversation when the host records its lineage, and SHALL NOT become the active conversation. A fork of a Session that no task retains and a fork of another task's conversation SHALL keep the host's native navigation and SHALL NOT be attached by the claim.

#### Scenario: Claim a branch of a task conversation

- **WHEN** the user branches an open conversation of the task whose drawer is open
- **THEN** the Kanban panel is selected again and the drawer stays mounted
- **AND** the host attaches the fork to the task
- **AND** the new conversation becomes the active drawer tab

#### Scenario: Prove a branch the catalog does not describe

- **WHEN** the refreshed catalog lists the branch without its parent
- **THEN** the client asks the host to prove the branch against the open conversation
- **AND** a branch that inherits that conversation's log is attached and becomes the active tab

#### Scenario: Keep the native navigation for a Session that inherits nothing

- **WHEN** the navigated Session is a new conversation rather than a branch of the open one
- **THEN** the host attaches nothing
- **AND** the Kanban panel is not selected again and the host's native navigation applies

#### Scenario: Report a failed claim

- **WHEN** the host cannot attach a branch the drawer claimed from its catalog lineage
- **THEN** the task's conversation tabs are unchanged
- **AND** the drawer reports the failure and offers to open the fork in the main chat

#### Scenario: Leave a fork created without navigation inactive

- **WHEN** a fork of a task conversation is created from the window's session action without changing the main Session selection
- **THEN** the fork is adopted as a new conversation tab when the host records its lineage
- **AND** the active conversation does not change

#### Scenario: Leave a fork of a subagent to the host

- **WHEN** the user branches a descendant while the drawer peeks it
- **THEN** the client does not claim or attach the fork
- **AND** the host's native navigation applies

#### Scenario: Claim the same fork once

- **WHEN** a claim is repeated for a fork the task already retains
- **THEN** the task's conversation tabs are unchanged
- **AND** no second conversation is created

## MODIFIED Requirements

### Requirement: Reuse the native DSH conversation experience

Task conversation tabs SHALL render the host's public native conversation window — its Session header, View tabs, transcript, composer, Session statistics, and execution — rather than introducing a replacement shell or agent runtime. Embedding the window in a drawer SHALL preserve the host's applicable tools, execution, permissions, mode selection, View selection, and the host's own composition of its subagent catalog, lineage, and branch actions.

#### Scenario: Render the native conversation surface

- **WHEN** a user opens a task conversation in the drawer
- **THEN** the drawer presents the host's native conversation window
- **AND** it does not present a plugin-owned replacement for the header, transcript, or composer

#### Scenario: Use native chat inside a task tab

- **WHEN** a user sends a message through a task's embedded native conversation
- **THEN** the request is handled as a native DSH conversation turn subject to the host's applicable execution and permission behavior

#### Scenario: Follow native subagent navigation

- **WHEN** the user selects a subagent in the window's native lineage or subagent catalog
- **THEN** the drawer follows that navigation and presents the descendant inside itself
- **AND** the host's main-panel navigation is not used for a target the open task owns
- **AND** no plugin-owned replacement of the catalog or lineage is rendered

### Requirement: Fork adoption into the task conversation

When a native DSH conversation fork is created or resumed on a host that records the fork's direct parent session, the plugin SHALL adopt it as another conversation of the task that retains that parent when the fork does not record `origin: subagent`, is not already associated with a task, and its direct parent is a retained conversation of that task. A host that records no lineage leaves an unclaimed fork foreign; the drawer's own branch navigation is covered by the proof in Fork claimed from the task drawer. The plugin SHALL NOT adopt a fork of a subagent descendant, a fork of a session that no task retains, or a session already associated with a task. Adoption SHALL be idempotent and SHALL NOT attach the same session to a task twice.

Adoption SHALL align the fork's effective directory with the task's effective directory before associating it. When that alignment fails, the plugin SHALL NOT associate the fork and SHALL report the failure. Adoption SHALL associate the fork through the same conversation-retention path as an explicit conversation creation, so the new conversation appears as an open conversation tab after the task's existing conversations and receives the task's normal conversation behavior. Adoption itself SHALL NOT change the native DSH navigation that follows a fork. Whether an adopted conversation becomes the active tab is decided by the drawer that claimed it, as defined by Fork claimed from the task drawer; an adoption the drawer did not claim SHALL be appended without becoming the active conversation.

When the task has a pending context operation at adoption time, the plugin SHALL retry adoption for a bounded interval and SHALL report the failure when the task remains unavailable. An adoption failure SHALL NOT fail, cancel, or roll back the native fork.

#### Scenario: Adopt a fork of a task conversation

- **WHEN** a user branches a retained conversation of a task
- **THEN** the fork is associated with that same task as a new conversation
- **AND** the task drawer shows it as an open conversation tab after the existing conversations

#### Scenario: Adopt a fork when its session is resumed

- **WHEN** a fork of a task conversation that is not yet associated with any task is resumed
- **THEN** the plugin adopts it into that task

#### Scenario: Do not adopt a fork of a subagent descendant

- **WHEN** a user branches a native subagent descendant of a task conversation
- **THEN** the fork remains foreign
- **AND** the task conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: Do not adopt a fork with no task-retained direct parent

- **WHEN** a fork's direct parent session is not a retained conversation of any task
- **THEN** the plugin does not associate the fork with a task

#### Scenario: Do not adopt the same session twice

- **WHEN** an adoption is announced again for a session already associated with a task
- **THEN** the plugin leaves the task conversation list unchanged

#### Scenario: Align the fork directory before associating it

- **WHEN** a fork of a task conversation has an effective directory that differs from the task's effective directory
- **THEN** the plugin moves the fork to the task's effective directory before associating it
- **AND** the adopted conversation can execute in the task directory

#### Scenario: A failed directory alignment leaves the fork foreign

- **WHEN** the plugin cannot move a fork to the task's effective directory
- **THEN** the plugin does not associate the fork with the task
- **AND** it reports the failure without canceling the native fork

#### Scenario: Retry while the task is busy

- **WHEN** a fork is created while the task has a pending context operation
- **THEN** the plugin retries adoption for a bounded interval
- **AND** it associates the fork if the task becomes available within that interval
- **AND** it reports the failure and leaves the fork foreign when the task remains unavailable

#### Scenario: Do not select the adopted conversation automatically

- **WHEN** a fork is adopted without a claim from the open drawer, including a fork created from the window's session action
- **THEN** the adopted conversation is appended without changing the active conversation
- **AND** only a fork the drawer claimed becomes active, as defined by Fork claimed from the task drawer

#### Scenario: Adopt a fork of a closed conversation as open

- **WHEN** a user branches a closed conversation of a task
- **THEN** the fork is adopted as an open conversation tab
- **AND** the original closed conversation remains closed

### Requirement: Native conversation window in the task drawer

In the Conversations section, the task drawer SHALL render one occurrence of the host's public native conversation window for the active task conversation instead of assembling the conversation chrome itself. The occurrence SHALL use the embedded variant and SHALL take its Session from the retained Session area that wraps it; the plugin SHALL NOT pass a Session identity as an occurrence prop. While the transient peek defined by Transient subagent peek inside the task drawer is open, the same occurrence SHALL render the peeked descendant and the drawer SHALL keep presenting the task's conversation tabs around it.

The host window SHALL compose the complete native surface: the Session header — title ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner — and the conversation body — the active View, transcript, composer, and Session statistics, including the composer statistics footer. The drawer SHALL NOT mount, register, or fabricate any header component, header input, View roster, or pin state. Contributions registered by the host and its plugins SHALL render through the window without per-occurrence registration. The drawer MAY render its own agent-preset card picker outside the window, as defined by Agent-preset cards start task conversations.

View facts SHALL remain per-Session and shared with the main panel: the View roster, unpinned View choices, the active View, and the composer draft SHALL NOT be duplicated by the drawer occurrence. The body SHALL use the View selected for that Session; the plugin SHALL NOT force a View or a conversation phase. An embedded occurrence SHALL omit the leading global-navigation seat and the application window-drag marker, and SHALL NOT inherit the main conversation column's frame clearance.

The drawer SHALL keep the conversation-surface gates around the occurrence: it SHALL track the displayed task conversation for read state, SHALL refuse to mount a second live composer for a Session that already has one, and SHALL report an open failure with the close action available. A peeked descendant SHALL NOT be acknowledged as a task conversation for read state or task attention. A header contribution that fails SHALL be reported and contained by the host's slot composition; the drawer SHALL NOT substitute a plugin-owned header or fallback row.

The window SHALL follow the active task conversation tab, including switching between root conversations, and SHALL NOT appear in the Info, Git, or Notes sections.

#### Scenario: Show the native window for the active conversation

- **WHEN** the user opens the Conversations section for a task conversation
- **THEN** the drawer renders the host's native conversation window
- **AND** the window shows the Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner
- **AND** the window shows the transcript, composer, and Session statistics footer

#### Scenario: Bind the Session from the retained area

- **WHEN** the drawer renders the window occurrence for a retained conversation or a peeked descendant
- **THEN** the occurrence renders that Session's window without receiving a Session identity in its props

#### Scenario: Render the peeked descendant through the same occurrence

- **WHEN** the drawer presents a transient subagent peek
- **THEN** the same window occurrence renders the descendant with its own native header and body
- **AND** the task conversation tabs remain around it

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

### Requirement: Task conversation lineage and ownership

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. A top-level conversation session SHALL include a conversation created for the task and a fork the task adopted. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations. A transient peek of a descendant SHALL retain that Session only while the peek is displayed and SHALL NOT change lineage ownership or any persisted conversation fact.

Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A fork the plugin has not adopted — including a fork of a subagent descendant and a fork of a session that no task retains — SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: An in-drawer peek does not persist the child

- **WHEN** the user peeks an owned subagent descendant inside the task drawer
- **THEN** the descendant is retained only while the peek is displayed
- **AND** the task's tabs, session IDs, closed-conversation list, and ownership are unchanged when the peek ends

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
