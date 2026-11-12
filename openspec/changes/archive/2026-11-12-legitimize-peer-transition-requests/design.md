# Design

## Context

See `proposal.md` — Why. The delta requirements in `specs/task-messages` and `specs/product-tools` are the behavior contract; this document records only the current state that constrains the approach and the technical choices behind it.

The advance path already supports the target behavior. `TurnAdvanceCoordinator` observes `turn/end`, `advanceArmed` decides whether the completed turn may advance (`autoMode.enabled` or a reason-carrying `recordedTransition` for the current stage), and `admitTurnAdvance` persists one `PendingTransition` with an origin of `'auto'` or `'agent'`. Nothing in that path reads the message source: a turn started by a cross-card message is an ordinary turn. A cross-card message is delivered with `agent.steer`, so an idle target starts a turn and a running target reads it at its next step.

What does not exist is the permission to compose the two. The constraint lives only in tool descriptions: `set_next_transition` says a declaration is for a transition "explicitly asked for, by the user or the stage instruction", and `send_task_message` says to send it "only when the user explicitly requests this message". The preset reference `coordination.md` additionally states that stage instructions and message bodies cannot manufacture authorization. Specs never encoded those restrictions, so the change is mostly a contract and documentation change plus proof, not a new runtime branch.

Two structural facts shape the approach: the per-origin arming condition exists twice (`turn-advance` decides whether to queue, `advance-admission` re-checks the same condition inside the durable transaction), and `list_allowed_transitions` already reads another task's stage and targets, so a sender can compose an exact request without a new tool or argument.

## Goals / Non-Goals

**Goals:**

- Make the composition legal and attributable with the smallest possible surface: descriptions, specs, preset guidance, and tests.
- Keep one authority rule: the receiving task decides; the request never moves the card and never authorizes another kind of write.
- Ensure the two arming reads cannot drift as the composition becomes a supported flow.
- Prove the composition at host level without adding a real-model lane.

**Non-Goals:**

- No new tool argument, envelope, marker, or stored field.
- No send-time validation of the request against the receiver's workflow.
- No new UI, indicator, inbox, or message history.
- No rate limit, loop prevention, correlation dedupe, or delivery receipt.
- No change to message delivery, deduplication, transcript presentation, worktree preparation, or auto mode.

## Decisions

### 1. The peer request stays ordinary text

A message may ask the receiving task to declare a transition, but nothing is added to the message: no argument, source field, marker, or body parser. Recognizing the request is agent judgment, exactly like the existing reply rule.

*Alternatives considered.* A structured `transition` argument on `send_task_message` would let the host validate the destination at send time, but it creates a second source of truth (body text and envelope can disagree), requires a schema and a migration habit for a feature that already works, and pushes messaging policy into routing. A source marker would put the request in the durable message identity, which duplicates the body and still cannot enforce that the receiver complies. A body template would be testable, but it would make a well-formed body mandatory for a capability the user described as a judgment call.

### 2. Authority stays with the receiving task

The receiver declares only through `set_next_transition` on its own task, and every existing rule still applies: destination configured by its current stage, nonempty reason, stage conditions, deterministic entries, pending user work, and unresolved stage entries. A peer request cannot select an unconfigured destination, cannot bypass a deterministic exit, cannot clear a hold, and cannot authorize task, board, note, or team-file writes.

*Alternatives considered.* Letting the sender move the receiving card through a new tool or a message-driven host action would remove the receiver's judgment, bypass `requireOwnTask`, and make attribution ambiguous — the card would move without its own conversation deciding. Treating the message body as sufficient authorization for any write would collapse the deliberate separation between protocol data and user intent that the preset documents; the proposal limits the exception to routing for that reason.

### 3. Sender authorization adds the stage instruction, not a token

`send_task_message` becomes available when the sending conversation's user asks for the message or when its stage instruction explicitly directs it. The tool description states both sources; no deterministic consent check is added, matching the existing model for board writes.

*Alternatives considered.* Keeping the user's request as the only source would force a human nudge between every handoff and contradicts the stage-authoring model, where the workflow author already decides what the stage does. A structured consent argument would look like enforcement without being one, since the model writes it. Asking the user at send time would make every handoff interactive.

### 4. The sender composes the request in two steps

The guidance tells the sending agent to call `list_allowed_transitions` for the target first, then to include the destination stage identifier and the reason in the body, and to ask for a reply when the outcome matters. The send call does not validate the request.

*Alternatives considered.* Validating at send time would fail fast, but it couples messaging to routing, duplicates a rule the receiver already enforces, and produces false failures when the target moves between the check and its turn. Appending a host-generated routing block to every delivered message would mirror the stage briefing, but it changes the text of every message, duplicates briefing logic, and could invite declarations no one requested. Relying only on the receiver's `list_allowed_transitions` call leaves the destination ambiguous when a stage configures several targets, which is exactly where a coordinator needs to be precise.

### 5. Documentation separates routing authority from write authority

`coordination.md` is rewritten so a stage instruction may authorize a handoff message and a routing request, while task, board, note, and team-file writes still require the user's explicit request. `operations.md` gains the peer-requested variant of the agent-selected route and its precedence rule: the receiving stage's conditions still decide. `SKILL.md`'s scope summary is updated only where it repeats the old rule. The README's two tool sections and the preset references stay the single authoritative place for each fact; no tool schema is copied into them.

*Alternatives considered.* Leaving the preset text alone would ship a contradiction between two authoritative documents. Spreading the exception across several paragraphs would duplicate the rule; AGENTS.md requires one authoritative place per fact and obsolete guidance replaced rather than appended.

### 6. One per-origin arming predicate

`advanceArmedFor(origin, workflow, task)` is added to `src/domain/transition-route.ts`. `advanceArmed` is expressed through it, `advance-admission` uses it in `blocked` and `requireArmed`, and the coordinator keeps using `advanceArmed` for the observation gate. The auto branch and the declared branch then come from one expression, so a future trigger cannot be armed in one read and refused in the other. The admission now also refuses a deterministic entry, which closes the window between the settle read and the durable decision; the new admission and domain tests cover that race.

*Alternatives considered.* Leaving the duplication is the status quo, but the composition makes the declared branch more reachable, and a divergence between "queue the turn" and "admit the turn" would produce silent no-ops. Moving the whole decision into the admission is not possible: the observation gate must avoid scheduling work it would always drop.

### 7. Tests prove the composition at host level

The suite covers the predicate (`advanceArmedFor` for both origins, a deterministic stage, and a recording made for another stage), the admission of an `'agent'` origin with auto mode off and under pending user work, the admission skipping a deterministic entry and refusing one that turned deterministic inside the transaction, and one app-level composition: deliver a message through a composed `InterCardMessaging` with a recording delivery port, record the declaration on the target, observe a `turn/end` for the target conversation, and assert the card moved. A negative case observes the same turn end without a declaration and asserts nothing moved. The existing suite (`turn-advance`, `advance-admission`, `inter-card-messaging`, `transition-tools`) stays green.

*Alternatives considered.* A new real-composition e2e lane would prove the browser path, but the browser adds no behavior here — the message row and the card move are already covered by the `messages` and `declared` lanes, and the new claim is a host sequencing claim. Testing only the domain predicate would miss the wiring between delivery and observation.

## Risks / Trade-offs

- **Any task in the Hub can ask another to move along its configured edges** → the destination is bounded by the receiver's workflow, the receiver's stage conditions still apply, the request cannot write anything else, and the receiving user sees the context row and the transition. The preset states the trust boundary explicitly.
- **Recognizing a request is non-deterministic** → the failure is observable (the peer simply does not declare) and the sender can ask for a reply; the contract says recognition is judgment, so no test pretends otherwise.
- **The default workflow configures no transitions** → out of the box a request cannot be satisfied. Documentation states the precondition; no runtime change hides it.
- **A deterministic stage ignores declarations** → its captured exit keeps routing authority; documentation states it so a coordinator does not wait for a move that cannot happen.
- **Two tasks can wake each other indefinitely** → no rate limit or loop prevention is in scope. The preset guidance bounds handoffs and treats a request as neither a dependency gate nor completion evidence.
- **Unattended chains lose the per-handoff human checkpoint** → the sender's stage instruction is authored by the user, the receiver's conditions still decide, and no other write is authorized. Teams that want a checkpoint keep it in the stage instruction.
- **Tool descriptions and preset references grow** → keep the additions to the essential rule, replace obsolete guidance instead of appending, and respect the preset size ceilings from AGENTS.md.

## Migration Plan

No stored data changes, so no migration runs. The change ships as a normal bundle release: update the descriptions, specs, and preset guidance in one commit set, bump `package.json` in the pull request that changes the installed artifact, and verify the preset mounts in an isolated DSH composition with its packaged references. Rollback is a revert of the same commit set; no persisted state depends on it.

## Open Questions

None.
