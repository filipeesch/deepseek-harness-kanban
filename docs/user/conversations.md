# Conversations

The drawer's **Conversations** section hosts DSH's public native conversation window for the active task conversation: Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner, followed by the transcript, composer, and statistics footer.

This document covers the drawer conversation area, the right Sidebar panel, notes, history, relations, and question rounds.

## Creating and switching conversations

When the task has no open conversation, the drawer presents the host's agent-preset roster as cards. Choosing a card creates the conversation, applies that preset, and opens it. The plus action opens the same card choice for another conversation, and a failed preset selection leaves the conversation on the host default with the card available to retry. The host's own preset seat and read-only mode label self-hide outside the main panel, so the drawer does not rely on them.

View selection, pin choices, and the draft stay shared with the main panel. Conversation tabs use the native session title, and the close action sits inside the active conversation tab. The Conversations tab carries one activity dot while an agent runs or background work is unsettled, with the facts in its tooltip and accessible name. Closed conversations stay reachable from the closed-conversations menu and can be reopened.

Branching a retained task conversation adopts the fork as another conversation of that task: the host attaches it, aligns it to the task's effective directory, and the task owns it for deletion and shared-worktree protection. The drawer asks the host for that attach and makes the new conversation the active tab. The host accepts the branch only when it records the conversation as its parent or inherits the start of its log, so a fresh branch is proven before the board returns. A Session the host does not prove — a new chat, a branch of another conversation — keeps the native navigation and attaches nothing, and a branch the host proved but could not attach is reported with an action that opens it in the main chat. A fork of a subagent descendant, a fork of a session no task retains, and, on a host that records the branch's lineage, a fork created from the window's session menu without a branch navigation are appended without becoming active; a host that records no lineage leaves that last fork foreign.

## Navigation inside the drawer

Navigation that the open task owns stays in the drawer. Lineage and subagent-catalog entries keep their native behavior: an owned descendant opens as a transient peek over the active conversation, the task's conversation tabs stay root-session-only, and the peek is forgotten when the drawer closes, another task opens, a task conversation is selected, the section changes away from Conversations, or the descendant is no longer available. The peek is never written to the task, so lineage, deletion counting, and shared-worktree protection keep their rules. Breadcrumb ancestors select their conversation tab.

While the board is open, selecting one of the task's own Sessions in the DSH sidebar also opens it in the drawer; leave the Kanban panel first to open it in the main chat. A target the open task does not own keeps the host's native navigation.

Keeping owned navigation inside the drawer reads the host's `retainedBy.mainView` Session reference and relies on its layout panel store flushing synchronously; a host release that changes either makes the classification fail closed, so the host's native navigation applies and no branch is claimed.

## The right Sidebar panel

The drawer can present the host's right Sidebar panel beside the active conversation. The panel is a host capability, not a plugin copy: the plugin reads the optional host service when the drawer renders and builds a port only when the host reports the capability and exposes a per-Session panel.

**Open and close** happen only through native controls: the conversation window's right-bar corner control expands the Session's panel, and the panel's own collapse control collapses it. The plugin keeps no panel-local expansion state, so the two surfaces cannot disagree.

**State is per Session and shared with the main chat**: the same tabs, layout, history, and `dsh.sidebar-right.v1.<sessionId>` persistence, and a terminal tab is one process. An open from either place reveals the same tab. Finishing with the last docked tab in the drawer also collapses that Session in the main chat, because that is the host's shared store.

**Width**: the persisted drawer width (`dsh-kanban.drawer.width`) remains the base. While the panel is expanded the drawer is reserved to fit the conversation minimum beside the rail, and a manual resize during that time changes the reserved width only. Collapsing the panel, switching to a Session whose panel is collapsed, leaving the Conversations section, or closing the drawer releases the reservation and restores the base. The rail width (`dsh-kanban.rail.width`, default 45% of the base drawer width, floor 320 px, at most 70% of the drawer) is one product-wide preference and is resized from its divider.

**When the viewport cannot fit both**, the panel covers the conversation inside the drawer; the conversation stays mounted and inert, and collapsing the panel returns it. The split is always preferred when it fits.

**Scope**: the rail follows the active root conversation. It is absent for a transient subagent peek, while a conversation is being created, with no open conversation, and in any section other than Conversations.

**Opens**: file and line links, page shortcuts, and assistant links configured for the Sidebar open in the drawer's panel, expanded or not. The host resolves an open for the Session it currently targets; when it cannot, the plugin re-issues the open through the host's per-Session open for the conversation the drawer presents, and the host reveals the panel as it does for any docked open. During a transient subagent peek the presented conversation is the task's, so the file is addressed to that conversation's panel; the peek draws no panel, so the open is not visible until the peek ends. A host that does not expose a per-Session open keeps its own failure, and a Session whose panel state was never materialized has nothing to open into; neither case reports an additional plugin error.

**Known limits**: the embedded occurrence is docking-only — tabs, add, and collapse; no split, fullscreen, or floating control, and split or fullscreen shortcuts with focus inside the drawer are inert. A floating pane created in the main chat stays there and is not drawn in the drawer. The panel requires a host that ships the panel factory; on a host without it the drawer renders exactly its previous conversation area, with no rail and no notice.

## Notes

Notes are shared by the task, not by a conversation. Each note keeps up to four lowercase tags, shows a Markdown preview, and opens in a wide editor overlay with Markdown and Tags, an Edit/Preview switch, and a delete action.

Tags are normalized on write: trimmed, lowercase, 15 characters at most, four per note. Tags can be authored in the drawer or by the note tools; `list_notes` filters by any of the given tags and `update_note` accepts content, tags, or both. Tags stored before normalization are compared and displayed normalized and stay untouched until the user edits them.

The Notes section filters by one tag at a time and remembers the choice per task. Note deletion is UI-only; the agent surface has no delete-note tool.

## History

**History** presents the task's recorded flow as one table with **When**, **Event**, **Detail**, and **In stage** columns: creation and initial stage, every stage entry, every next-stage destination an agent recorded, every auto mode change with the reason that paused it, and every worktree creation, attachment, removal, or failure. Rows are newest first and the list is not capped. The In stage column carries how long the task stayed in each stage, refreshing while the section is open. Nothing before the feature was recorded or inferred, and the record stays out of agent tool payloads.

## Relations

The drawer presents the card's relations in a read-only section placed before History, naming the other card's stage and, when it lives elsewhere, its board. Creating or removing a relation remains a tool action, so there is no route from a row to the other card. [Agent tools](agent-tools.md) describes the relation contract.

## Question rounds

Rich question rounds work in task and ordinary DSH chats: single or multiple choice, or text, with Markdown explanations, recommendations and rationales, importance, Other, and notes.

The active round is a fixed strip docked directly above the composer, like the host Todo and Goal bars: the chat scrolls while the strip stays in place, it collapses to its header bar, and it is expanded by default. Every question is one slide with its choices, focused-choice description, optional per-answer Notes, and Next; the last slide is always **Additional Notes**, and Submit exists only there. Pages may arrive incrementally and stack into the strip while answers are retained; a page that arrives while Additional Notes is open is announced with an action that opens it without losing the draft.

**Submit** sends one ordinary textual reply in the originating conversation and the strip leaves the dock immediately, restoring the draft and showing the admission error if the send fails. Submit stays disabled until the agent's turn ends and every answer is valid, and the footer explains that turn-completion gate. The tool's own guidance tells the agent to send every page the round needs and then always end its turn after the last page; the per-call result repeats that short rule.

Question state streams per conversation, independently of the board snapshot, so turn completion, retirement after Submit, and retirement after an ordinary chat reply do not wait for board attention projection. Question rounds are stored durably per conversation, not per task, so an unanswered round returns after reload.

The form draft is durable too: selected choices, Other text, per-answer notes, Additional Notes, and the slide the user was viewing are stored per conversation and restored when the round is shown again, including after closing the drawer, switching conversation, closing the conversation, or reloading. Only the collapsed state belongs to the open strip, so a restored round returns expanded like a new one. A stored draft is never submitted or written to the transcript automatically, and it is discarded when the round is submitted, answered by an ordinary reply, or dismissed. Draft records are bounded to the 100 most recently updated conversations, and deleting a task removes the question rounds and drafts of its conversations.

The footer has a **Dismiss** action on the left. An untouched round dismisses immediately; a populated draft asks for inline confirmation. Dismissing removes every unresolved round in that conversation, discards their stored drafts, sends no chat message, and permanently hides the round from reload and replay while leaving the composer available. Future rounds still appear.

A genuine native ask-user or permission request stays independent. Dismissing a rich form or sending its text does not settle an unrelated native pending interaction.

## Unreadable conversation

A conversation whose Session log cannot be read is reported instead of appearing idle. The task card carries a **Session log unreadable** status line, and the same state appears inside the conversation above the composer, in the task drawer and in ordinary chats alike. A conversation that was never created reports nothing, and a missing log gets its own **Session log missing** line.

The diagnosis names the state, keeps the cause the host reported, identifies the Session, and shows the log path under **Details** with **Copy log path**. **Recheck** reads the log again without restarting anything. **Repair…** appears only for an unreadable log and asks for confirmation before writing.

Repair renumbers only repeated PTC dispatch identifiers, the per-execution counters `run_code` writes, and changes nothing else. The confirmation states that scope, the original is kept as a backup, and the result is validated before it replaces anything. A log with no repeated identifier, a damaged tail, or a conversation open in the host is refused, and a repaired log asks you to reopen the conversation to load it. The guarantees and limits of the write are in [recovery](../operations/recovery.md#unreadable-conversation).

Sending from Kanban into an unreadable conversation is refused with the same diagnosis; the native composer belongs to the host, which reports its own failure. The card stays listable, movable, and editable throughout.

## Stale views and failed updates

A stream failure keeps the last board state and is presented by the board-update status on the Kanban page, where **Retry updates** restarts the live feed; that status, its message, and its retry never appear in a native conversation. A rejected command is reported by the surface that started it — the board's command-failure notice, a dialog, or the drawer — not by the board-update status, and an initial load failure uses **Retry loading board**. Question rounds report their own failure with **Retry questions**, so an ordinary chat keeps working while the board feed is down. Reopen a failed native tab or use its displayed retry action.

Creation commands return a transient exact entity receipt for that command; the UI does not infer a new project, task, tab, or note by comparing snapshots. A missing receipt or unavailable created entity means inspect or refresh and select the saved entity explicitly before trying another creation. Receipts are not a persisted ledger or an execution-success record. Project drafts and selection are locked during saves, and a stale completion cannot rebind another draft.

A duplicate Kanban composer warning means another plugin view is already composing in that conversation; close it rather than copying the chat implementation.
