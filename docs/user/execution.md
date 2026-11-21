# Execution

A card moves by being dragged, by the drawer's stage control, or by the card's next-stage button. This document covers what happens after the move: the first-execution preparation, the timed stage instruction, the play action, declared transitions, and auto mode.

## Moving a card

A permitted move, or a same-stage reorder, is immediate and organization-only. A transition the workflow does not permit opens a confirmation first and moves only after **Move anyway**; canceling leaves the card in place. Neither the confirmation nor the move starts an agent by itself.

The drawer's stage control lists every workflow stage in order, marks stages that require confirmation with lower emphasis, and offers a one-click advance to the next stage under the same rules. A destination the workflow does not permit is shown with lower emphasis but stays selectable, and choosing it opens the same confirmation as a restricted drop. If the host rejects the move, the dialog stays open with the problem and a retry that rechecks the current task and workflow; a changed source or a missing destination is reported without a retry that cannot succeed. On admission the host records a transient consent on the pending transition, so a retry or restart completes the same confirmed move without changing the workflow. The native select popup may ignore the muted color on macOS; the confirmation remains the guard.

## First execution preparation

When a move or the card play action would start the task's first execution (the task has no conversation), the worktree question comes before the move. The dialog asks whether to create a worktree when the task has none and no recorded base choice, and it closes as soon as the choice is recorded, so the card moves immediately afterwards.

The rest of the preparation runs in the background. For a Git-backed project the default worktree is created as a background operation that keeps running while the panel is closed or reloaded. The first conversation is created once the worktree is ready, and the five-second countdown below is armed only then. While that work runs, the card's status region names the step, and the card's play action is unavailable.

A project whose policy is **Always create** skips the question and creates the default worktree. A task that already has a ready worktree, recorded a base-project choice, belongs to a folder project, or whose project never creates worktrees needs no dialog: the move applies and the countdown is armed as soon as the first conversation exists.

The preparation presents no model choice. The first conversation uses the board's default model when the board names one the host offers and the deployment default otherwise, and DSH's own model selector stays available in the conversation afterwards.

Canceling the question leaves the card in place and creates nothing. A worktree binding that is preparing or in error blocks that first execution until it is resolved in the Git section; a task that already has a conversation keeps executing.

A failed background creation keeps the stage the card moved to and reports the failure in the card's status region; when the host recorded the operation, the drawer's operation status and the Git section report it too, and their recovery actions resolve it. The play action stays unavailable while a failed operation is recorded. A reload between the worktree becoming ready and the conversation being created leaves the worktree in place, creates no conversation, and leaves the entry unresolved with the play action available.

Task creation does not show that dialog. When the initial stage is instructed and the start option is enabled, it creates the default worktree in the background and follows the same flow; [Getting started](getting-started.md) describes the dialog.

## The timed stage instruction

A move into a stage with an entry instruction starts a cancelable five-second countdown once the move is applied and, when the first execution needs one, the first conversation exists. The card's play slot becomes a countdown that cancels when clicked, and the drawer shows the same countdown above its panel without changing sections.

When the window elapses, the stage's exact instruction is sent to the task's first open conversation, creating one when none is open (for example, when every conversation is closed). **Cancel** stops only the automatic send: the move stays, the entry remains unresolved, and the card's **play** action returns.

The window is fixed at five seconds, is not persisted, and is not shared across tabs. It continues while the card is filtered, the Kanban panel is hidden, or another board or Hub is active. Reloading or restarting the plugin sends nothing and leaves the play action. A manual prompt, a new instructed entry, deletion, or any marker change cancels the window. A changed instruction is not a cancellation: the timer fires, admission rejects it, and the failure is shown with the play action restored. An unsent draft in the target conversation does not block the send and is left untouched.

A failed timed send is reported on the card and in the drawer and is not retried automatically. A timed send is a normal prompt admission, not a composer submission.

## The play action

The card's **play** action sends the current unresolved instruction immediately, after the same preparation when the task has no conversation. It is hidden when the task has no unresolved instructed-stage entry. Sending the instruction manually also clears a failed entry record.

## Task context

Every task conversation receives a native, model-facing task-context message before its first user message, once per conversation. The message contains the task title and ID, description, the owning Hub and board names, the workflow stage at first contact, and a first-contact workflow map: the workflow description, one entry per stage with its kind, responsibility, and exits with their conditions, the task's stage marked, the project scope, the sharing state, and the task's automatic-mode state. It does not start a turn, and it requires no startup tool call.

The map is first-contact context, not live routing authority: the orientation block and the stage notice below name the live stage, and after a workflow change `get_workflow_summary` gives the current projection before a route is decided. The map has its own 16 KiB budget, separate from the attachment listing's. When it exceeds the budget it leaves out whole stages instead of cutting an authored description or condition, and it states how many stages it left out and names as many of them as fit a fixed allowance, so the summary tool can read the rest.

The plugin presents the context through a visible inline native Chat context row: a custom visible node claims the plugin-owned `kanban-task` message and delegates to the host's context-row renderer, so the row is part of the transcript and scrolls with it in ordinary native Chat and in the drawer when the host supports the native conversation window. It names `kanban-task` and reveals the full text on expansion.

Later stage instructions open with the stage orientation block below, then carry the instruction and, when the stage configures two or more targets, the transition briefing described below. New conversations get their own context; conversations whose first message already exists are not backfilled.

## Stage orientation and the stage notice

Every stage instruction the host delivers opens with a stage orientation block of facts from the live workflow: the stage's name, identifier, and kind, its responsibility (the stage description), how it routes, and its exits with their conditions. Each exit destination's responsibility appears while the block stays within 4 KiB; past that the block keeps every exit and condition, omits the destination responsibilities, and says so. The block states facts and directs nothing, and it is the same for every preset.

When a task enters a stage and no instruction reaches a conversation, that conversation receives one stage notice before its next input. This happens after a manual move, in a stage without an instruction, at a decision gate, in a scripted stage, and when the instruction has not been run yet. The notice names the stage, says why no instruction came, and carries the orientation block, never the instruction text. A stage entry is announced to a conversation at most once, and a conversation whose history records no stage entry is not told. When the last stage message of an input still names an earlier entry, the notice follows it and says that message is out of date. If the conversation was told about the current entry already, that notice is a short correction with no status line and does not count as a new announcement; no queued message is dropped. The notice is a collapsed context row, not a user message, and it never starts a turn.

## Declared transitions

A stage with two or more permitted destinations can ask the model to declare where the task goes next. The model reads the options with `list_allowed_transitions` and declares with `set_next_transition`.

A declaration is legitimate when the user asked for it, when the stage instruction asked for it, when a message from another task explicitly asked for it, or when the active preset's guidance directs it. A preset can be stricter, and the workflow operator is: it does not treat a request from another task alone as a direction, and its rule is in [Presets](presets.md). In every case the destination must be one the current stage configures, and the stage's scripted entry, holds, and admission guards still decide whether the task may leave; the conditions listed with a destination guide the choice, and the host does not evaluate them.

Declaring a destination requires a reason. A blank reason is rejected, and a reason of more than 200 characters fails the call with the limit instead of being shortened. The reason is how the next stage learns why the task arrived: when the advance follows a declared transition, the delivered message is that stage's instruction, then the reason naming the stage the task left, then the briefing. A destination without an instruction moves without delivering the reason, and the reason is never stored on the task after the move.

The call itself never moves the task, sends a message, or changes auto mode. The task moves at the end of a completed turn whether or not auto mode is enabled, which is what lets a workflow route deliberately without turning auto mode on.

Clearing the declaration, by calling the tool with no destination, needs no reason and disarms the declared route: a task whose auto mode is disabled then moves nothing, while one whose auto mode is enabled still advances by the default route at the end of its next completed turn.

The write tool acts only on the task that owns the calling conversation, while the read tool can still resolve another task. A declaration belongs to the stage it was declared in and is discarded when the task leaves that stage. A declared transition is downgrade-sensitive: [Recovery](../operations/recovery.md) states how to prepare the Hub before selecting an older plugin build. If a workflow edit removes the target, the declaration no longer resolves: no advance is admitted, auto mode pauses with `transition-stale` when it is enabled, and the drawer's next-stage action refuses with the same explanation instead of moving the card. Moving the card by hand, or choosing another stage in the drawer, clears the pause.

An existing destination the stage does not configure can be declared only with the `exception` flag and only when the user directly and explicitly requested that destination in the same task conversation. The flag is the model's assertion, not independent proof of intent. The host binds it to that task entry and originating turn, admits it only after that turn is observed completing successfully, and keeps the usual pending-work, destination, and scripted-approval guards. A turn that fails, aborts, is interrupted, or cannot be verified invalidates the exception; it is never retried by a later turn or reused as an automatic-mode destination. An admitted move keeps normal durable recovery. This does not change the manual confirmation for restricted moves or enable auto mode.

## Transition briefing

When a stage configures two or more transition targets, the host appends a briefing to the stage instruction it sends: the transition already declared, the target used when nothing is declared, and the available `set_next_transition` call with the reason it requires and that reason's 200-character limit. The targets and their conditions are in the orientation block. The briefing describes routing without directing the agent to declare a transition. It is built from the live workflow at send time, so an edited workflow never leaves a stale description in the message. A stage with fewer than two targets gets no briefing.

## Auto mode

A task can advance without a drag. Its card shows an **Auto** chip in the activity row, and the drawer header mirrors the same chip, whose tooltip and accessible name carry the current state, including a pause reason. Auto mode is off by default, belongs to the task rather than to a stage or a conversation, and moving the task by hand does not turn it off. The creation dialog can enable it; enabling it there persists the setting but does not start the first execution, which the **Start execution now** option governs. Turning it on only arms the task: it never moves the card, changes its position, or sends a prompt.

When one of the task's open conversations ends a turn as `completed` and the task owes the user nothing, the host moves the task to its next configured stage and, when that stage has an entry instruction, sends it to the first open conversation, creating a conversation when every tab is closed.

The task owes the user any pending user work in any of its conversations, including a closed tab: an unanswered structured question round, an unanswered native question, a pending approval, or a user message still queued for the next turn. A queued stage instruction the host sent itself does not count. The host re-reads that state right before it admits the move, so a question admitted during the settle window cannot be bypassed. An unreadable conversation state is not idle: the read fails and the advance holds. While the task owes the user input, the **Auto** chip shows a held state that names what is missing, and no advance is admitted; the hold clears when the last item is consumed, and no pause is recorded for that wait.

The destination is the transition the task recorded for its current stage while that recording resolves; otherwise the first entry of the stage's `allowed_transitions`, or the next stage in workflow order when the stage does not configure transitions. A recorded transition is followed exactly: the task moves to that stage and resolution stops there. Stages without an entry instruction are crossed toward the first reachable instructed stage only on the default path; when no reachable stage has an instruction, the task stops at the last reachable stage, and a visited stage is never revisited. A configured cycle is never looped.

The resolved destination and instruction are captured at admission, so a later workflow edit does not rewrite an admitted advance. Admission re-resolves the destination against the current workflow; if that destination changed or disappeared, the attempt records an `advance-failed` pause instead of moving the task to a stage the workflow no longer chooses, and a declaration that stopped resolving records `transition-stale`. Those records exist only for a task whose auto mode is enabled: a task whose auto mode is disabled records no pause and stays in its stage, and its declaration waits for the next completed turn.

Every other turn ending (`error`, `blocked`, `aborted`, `max-tokens`) records a pause with the matching reason and does not advance, for a task whose auto mode is enabled. The pause survives reloads and restarts and is presented by the **Auto** chip in the card status strip, in its tooltip, and in its accessible name.

An admitted advance that fails is reported through its transition state, keeps auto mode enabled, and is not retried automatically: the card play action remains available for the unresolved entry, and the drawer offers an explicit retry or a dismiss of the failed record.

The advance is a host action: it works while the Kanban panel is hidden or another board or Hub is active, and reloading the UI neither cancels nor duplicates it. It does not arm the five-second countdown, requires no confirmation, and never asks for a worktree choice. Only a completed turn advances.

The host does not catch up: a turn that ended while the plugin was not observing its conversations is not replayed after a restart, and the chain resumes on the next completed turn. An advance that was already persisted is still dispatched after a restart.

## Pausing and resuming

An agent can stop the chain deliberately. `pause_task` records a pause with a reason the agent has to supply; a blank one is rejected, and an over-long one fails the call instead of being shortened. The task stops advancing while auto mode stays on, so the user's setting is not lost.

Three actions resume the task: activating the **Auto** chip, `resume_task`, or moving the card by hand; disabling auto mode also clears it along with the setting. Sending a message does not resume it, so the workflow stays where the agent left it until someone acts. Resuming never moves the card and never sends an instruction, the next completed turn remains the only trigger, and it never enables a task whose auto mode is off. An agent pause and a failed turn are separate records, so a card can present both. Pausing never clears the recorded transition, and clearing a recording never pauses.

## Failures and recovery

A move, a preparation, a timed send, or an advance that fails is reported by the surface that started it: the card, the drawer, or the confirmation dialog. [Recovery](../operations/recovery.md) covers the durable records, the retry and dismiss actions, and the conditions that must be resolved first.
