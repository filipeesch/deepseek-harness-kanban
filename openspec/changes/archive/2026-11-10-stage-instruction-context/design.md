# Design

## Context

See `proposal.md` for motivation and the delta specs for the behavior contract.

Today one host admission path — `admitStageInstruction` in `src/host/stage-instruction.ts` — validates the stage, the reviewed instruction text, and the entry identity, composes the instruction with the transition briefing, and sends it through the session port, which durably admits a **user prompt** (`sessionController.prompt({ mode: 'queue' })`) deduped by its request id. Five entry points share that path: the card run action, the timed instruction after a move, the confirmed-transition drain, the automatic advance, and the agent-created first execution.

The task-context message already demonstrates the alternative channel: a plugin-sourced native message rendered by the host as a context row. It is injected into the first `agent/pre-step` and deliberately does not start a turn.

Host facts this design depends on (all public, none deprecated in the pinned DSH source):

- `agent.followup(message)` queues a message at the next-turn boundary and wakes the driver; the message becomes the sole ordinary message of its own turn.
- `sessionController.resolveAgent(sessionId)` resumes a cold session and returns the live agent.
- `createUserMessage({ content, source })` mints a stable identity and accepts a merge-extensible source.
- The chat client classifies a `user/message` whose `source.kind` is not `user` as context, and a waking one as the turn trigger that starts a Turn; the source kind becomes the row's visible producer label.
- A source declaring `form: 'notice'` with a `summary` renders a collapsed row with that one-line account; `boundContextSummary` bounds it to 120 characters.
- `session-title` derives automatic titles only from messages whose `source.kind` is `user`.
- `PluginPromptLedger` exists only because host-admitted prompts are otherwise indistinguishable from human input when reading pending user work.

## Goals / Non-Goals

**Goals**

- One delivery channel for every stage instruction, at the same admission boundary that exists today.
- Identical model-facing content: the entry instruction, then the briefing when the stage configures two or more targets.
- At-most-once delivery across restarts and drain replays.
- A smaller admission module and delivery logic that is unit-testable without a live host.
- One shared context-row presentation for both plugin messages, and no per-feature styling.

**Non-Goals**

- Changing the first-turn task context injection.
- Changing scheduled prompts, which remain human-authored prompts.
- Migrating, rewriting, or backfilling already-recorded user-message instructions.
- Renaming or auto-titling conversations.
- Changing the countdown UX, the entry marker lifecycle, or the error surface of admission.

## Decisions

### 1. Deliver a plugin-sourced message through `agent.followup`

The stage instruction becomes one `user/message` with `source.kind = 'stage-instruction'`, delivered by `agent.followup`. This is the only channel that both carries plugin provenance and opens the turn: a `pre-step` injection alone cannot start a turn, and a native prompt cannot carry a custom source.

Consequences: the model receives the same text as today at the same position, the client renders the message with its native context presentation, and host projections that read human input stop seeing it as user work without a plugin-side ledger.

Alternatives rejected:

- *Pre-step injection plus a synthetic user prompt.* Requires a second message ("Continue"), changes the model-facing request, and adds a human bubble to every task conversation.
- *`agent.steer` instead of `followup`.* Same model semantics but steering is designed for mid-turn input; an idle steer parks input at the next-step boundary and can sit behind a rejected step.
- *Keep prompts and claim them in the client.* Impossible: prompts carry `source.kind = 'user'`, so a client cannot distinguish a stage instruction from something a person typed.

### 2. Shape the durable source as a `notice` with a bounded summary and claim it with a Chat Definition

`source = { kind: 'stage-instruction', form: 'notice', summary, requestId }`. The kind is the row's visible producer label, so it is chosen to read well and to follow the host's kebab-case convention. The notice form is what makes a collapsed row readable: without it the row shows only the label and the body stays opaque.

The summary names the entering stage and, when a transition target applies, that target — the recorded transition while it resolves, otherwise the first configured target. It is composed through `boundContextSummary` so the durable log keeps a bounded account.

The row is presented by the host's native context-injection renderer, but Chat's ordinary message Definition hides a claimed next-turn message whose source is not `user`. The acceptance lane proved it: the turn ran, the model answered, and no row was rendered in the drawer. The plugin therefore claims the message with an exclusive Chat Definition that delegates to the host renderer, exactly like the task-context row, and keeps an inline fallback for a host without that renderer.

Alternatives rejected: relying on the native definition alone (invisible in the task drawer, as the acceptance lane showed); a bespoke row instead of delegating to the host renderer (breaks the native disclosure presentation); omitting `form` (collapsed row with no summary).

### 3. Split composition and delivery out of the admission module

- `src/host/stage-message.ts` — pure: given the stage, the instruction text, the briefing, and the delivery identity, return the message value (content blocks, source, summary). It reuses the existing transition helpers for the target name and does no I/O.
- `src/host/stage-delivery.ts` — delivery with injected ports (`agent(sessionId)`, `events(sessionId)`): resolve the live agent, apply the durable dedupe, call `followup`. Mirrors the existing pure-module style of `first-execution.ts` and `schedule-runner.ts`.
- `admitStageInstruction` keeps validation, session resolution, execution-context assertion, and marker cleanup; its dependency changes from `send(sessionId, text, requestId)` to `deliver(sessionId, message)`.

Rationale: the admission module stops owning text composition and host delivery; both new units are testable without a live agent; `app.ts` gains only wiring.

Alternative rejected: extend `native.ts`'s `send` with a mode flag. It would put two unrelated lifecycle rules (human prompt identity versus plugin message identity) behind one boolean and grow the adapter's largest function.

### 4. At-most-once by reading the conversation's durable log

`followup` has no request-id dedupe. The confirmed-transition drain is replayed after a restart, so delivery must be idempotent on the delivery identity:

1. Join concurrent calls for the same (session, identity) in memory.
2. Read the session events and skip when a `user/message` with `source.kind === 'stage-instruction'` and the same identity is already recorded; also treat an identical pending inbox message as delivered.

Only deliveries that carry a replay-able identity pay for the read; a fresh card run mints a new identity and delivers directly.

Alternatives rejected: a persisted delivery ledger in the hub record (schema change and a second source of truth); relying on the in-memory map alone (a crash between followup and marker cleanup would duplicate).

### 5. Keep the human-prompt port for schedules and narrow the ledger

`SessionPort.send` keeps its request-id semantics for schedule prompts, which are human-authored and must keep counting as user work. `PluginPromptLedger` therefore stays, but its purpose narrows to schedule prompts; stage-instruction entries are removed and the type documents why.

## Risks / Trade-offs

- [Instruction text is hidden behind a collapsed row] → The summary names the stage and its target; the row expands on click; the durable message keeps the full text.
- [A host stops composing its context-row renderer] → The plugin Definition keeps an inline fallback that preserves the instruction text, so the row stays readable.
- [A conversation started only by a stage instruction has no derived title] → Accepted by decision. Plugin tabs fall back to `Agent N` and the native rename stays available.
- [`followup` needs a live agent where `prompt` resumed one implicitly] → Delivery resolves the agent through `resolveAgent` first, checks the inbox that resolving restored, and reports its stable failure; admission keeps the entry unresolved.
- [Delivery now depends on the session log read for replay-able identities] → The same admission already reads task state and validates the directory; the read is bounded to replayed deliveries.
- [Existing end-to-end templates locate the instruction as a plain user message] → Update the three templates to the context-row presentation; replay stays valid because the model-facing request is unchanged.
- [A transcript assertion that "the instruction is absent" may still match collapsed body text] → Verify against the rendered row in implementation and scope those assertions to visible content.

## Migration Plan

No data migration: stored instructions keep their recorded source, and the new source applies to new deliveries only. Rollback is a single delivery switch — restoring the prompt path makes new deliveries human prompts again while both forms remain readable in existing conversations. Ship the `package.json` version bump in the same pull request, per the project release rules.
