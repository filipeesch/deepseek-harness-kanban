# Design

## Context

See `proposal.md` for motivation and the two spec deltas for required behavior.

- The native header actions are ordinary slot entries in `conversation.session.header.actions`. Even when the native header is not rendered, those entries stay in the global slot registry.
- A plugin cannot render that slot: slot rendering is ownership-scoped, and the action components are private. A public factory would require a DSH change. The alternative is the pinned-host host described below.
- The three actions relevant here are registered as:

  | Entry id | Order | Locale | Native props |
  |---|---|---|---|
  | `agent-preset` | `-10` | `settings.agentPreset` | `useSessions`, `useAgentPresets`, `load`, `t` |
  | `subagent-catalog` | `10` | `subagent` | `useSessions`, `useSessionStatus`, `openChild`, `openChildAside`, `refreshProjection`, `t` |
  | `job-list` | `20` | `job` | `useJobs`, `watchRows`, `observe`, `killJob`, `t` |

- The DSH slot renderer already assembles exactly this shape. `runInject` calls `entry.inject(sessionId)`, `bindInjectSources` turns each `hooks` source into a `use<Name>` selector hook, `standardKit` supplies the session standard hooks and the locale `t`, and `renderEntry` renders `entry.component`. The host reproduces that assembly without the renderer's ownership check.
- The native interactive picker is not in the actions list. It is the hero seat, bound to the main-view/next-session controller; it is outside this design. The drawer shows the native mode label read-only.
- The DSH frame publishes `--dsh-frame-leading-clearance` while the macOS sidebar is fully collapsed (`160px`, or `84px` in fullscreen). The native conversation header already pads by it. The Kanban board header currently uses a fixed 20px inset, so its title and controls sit under the traffic lights and shell controls.
- The plugin pins DSH `0.2.1-rc.2`. The host integration is deliberately coupled to that release's private entry ids and prop shapes. No DSH version change is part of this design.

## Goals / Non-Goals

**Goals:**

- Render the real native mode, subagent, and background-job UX in the task drawer on the pinned DSH release.
- Keep the row per active conversation, outside the native transcript scrollport, and hidden when empty.
- Display the mode read-only; no picker and no preset selection call.
- Fix the board header's collapsed-sidebar leading clearance.
- Keep the host and remote contracts unchanged.
- Split the conversation area before adding the row.

**Non-Goals:**

- Changing a conversation's mode, or adding a mode picker.
- Changing DSH code or depending on a new DSH release.
- Reimplementing the native action labels, counts, popovers, or behavior.
- Aggregating subagent or job activity across a task's conversations.
- Any task-card/main-chat navigation shortcut.
- Supporting a different DSH host layout under the same plugin build.

## Decisions

### 1. Host the native action entries directly

Add a plugin-owned `NativeSessionActions` module that:

1. Reads `ctx.slots.entriesOfSlot('conversation.session.header.actions')`.
2. Filters the entries to `agent-preset`, `subagent-catalog`, and `job-list`; sorts by `options.order`; ignores header-only actions such as agent-team or terminal recovery.
3. For each entry, builds the same prop set the slot renderer would:
   - the session standard props from the plugin's `kanban.session.status` slot (`sessionId`, `useSession`, `useSessions`, `useSessionStatus`, `useSessionRetainInfo`, `useProjection`, `useAccess`, `useConversation`, `useInput`, `inputActions`, `useWorkspaces`);
   - the header-actions slot has no owner-specific fields, so the host adds no owner props;
   - `entry.inject?.(sessionId)` spread (the native business face);
   - each `face.hooks` source converted to a `use<Name>` selector hook over stable method-bound `getSnapshot`/`subscribe` closures (matching the native `bindSnapshotSelector`);
   - `t` from `ctx.locale.bind(entry.locale)`.
4. Renders `entry.component` with those props inside a per-action error boundary.

This is not a slot render; it bypasses ownership and the renderer's boundary. The host is a deliberate private integration, contained in one module and guarded by tests that assert the three entry ids and the expected prop wiring.

Alternatives considered:

- *Wait for a public DSH factory.* Supported, but blocked on an upstream release and a version bump. Rejected for this change.
- *Reimplement the action UI with native data.* Stable, but rebuilds the mode label, subagent tree, and job panels and loses the native popovers. Rejected.
- *Host the hero mode picker too.* Its controller is bound to the main-view/next-session binding; it would target the wrong session. Rejected.

### 2. Read-only mode

The mode action is the native `AgentPresetLabel` entry. The host renders it like the other actions; it is a static label with the native icon and roster name. The plugin never calls `agentPresets.select`, never renders a picker, and never presents a control that implies mode can be changed. Blank and started conversations both show the label when the native entry renders.

### 3. Row, slot, and frame

Add `kanban.session.status` as a session-scoped child of the plugin's `main:kanban` entry. `RetainedConversation` renders the provider around a frame:

```text
<Provider session={reference}>
  <div class="kb-session-frame">
    {renderSlot('kanban.session.status', {})}
    <div class="kb-native-conversation">
      {renderSlot('kanban.conversation', {})}
    </div>
  </div>
</Provider>
```

- `SessionStatus` reads the native entries, subscribes to the slot's mutation channel so late registration refreshes the row, and renders `NativeSessionActions` in a `role="group"` row with `data-conversation-status`.
- The row sits under the agent tabs, above the native content, with `display:flex`, `gap:8px`, `container-type:inline-size`, and `:empty{display:none}`.
- The frame and panel are flex columns with `min-height:0`; the row is `flex:none`, and the native content keeps its existing 160px scroll floor. The drawer's old `.kb-native-conversation` wrapper moves under the frame.
- `SessionStatus` renders only while the session's `openState` is `open`; the frame is not rendered while the retention reference is unresolved or errored.
- Info/Git/Notes unmount the conversation body, so they cannot show the row.

### 4. Board header leading clearance

Add to `.kb-header`:

```css
padding-inline-start: max(20px, var(--dsh-frame-leading-clearance, 20px));
```

- The host sets the token only on macOS with a fully collapsed sidebar (`160px`, `84px` in fullscreen). The fallback preserves the current 20px inset everywhere else.
- The header already wraps; the title/subtitle/toolbar remain in the flow and should reflow rather than clip. The token is read through normal CSS inheritance from the frame.
- The fix is desktop-specific by nature; the browser live-verify cannot reproduce the Electron traffic lights. Verification uses a CSS/host-token check plus a manual desktop check at collapsed and fullscreen widths.

### 5. Locale dependency

The host needs `ctx.locale` for the native `t` seats. Add `@deepseek-ai/dsh-client-locale` at the existing rc.2 pin, add it to `dsh.client.inject`, inject `locale`, and import its client types. No other DSH package changes.

### 6. Refactors

- `resolveActiveConversation(sessionIds, closedSessionIds, selected, fallbackAllowed)` — open ids, selected id, fallback selection, and the no-fallback state, shared by the tab strip and the row.
- `ConversationTabs` — tablist, rename, new/close.
- `ConversationBody` — native boundary, provider/frame, content slot.
- `SessionStatus` — the `kanban.session.status` slot component.
- `RetainedConversation` in `client.tsx` — the existing retention path, now wrapping the native content in the frame.
- Remove the trivial `NativeView` wrapper.

`TaskDrawer` keeps the task header, section toolbar, and section panels. `SessionTitles` remains title/rename-only.

### 7. Layered verification

- **Host unit** (`tests/client/native-session-actions.test.tsx`): fake slot entries and fake native components; assert filtering/order, `inject(sessionId)`, standard props, `t` namespace, `use<Name>` hook synthesis and selection, and no plugin fallback when entries are absent.
- **Pure selection** (`tests/client/conversation-surface.test.ts`): `resolveActiveConversation` for selected/open, closed/stale, no selection, and all closed.
- **Bridge** (`tests/bridge/plugin.test.tsx`, `tests/bridge/cordis.test.ts`): `main:kanban` declares the status child; the status slot renders before the conversation slot inside the provider; one status slot per drawer; tab switches remount; Info/Git/Notes unmount; locale fake available.
- **Board regression** (`tests/client/board.test.tsx`): existing tab/new/close/reopen/section tests; a style-token assertion for the header clearance.
- **GUI smoke** (opt-in, owner-authorized, pinned release): open a task with native actions, confirm the real native mode label and subagent/job popovers appear in the row; switch tabs and sections; confirm the drawer stays open on a native popover; confirm the row stays outside the native scrollport without double scrollbars. No real model. Native internals remain DSH-owned.
- **Desktop check** (manual): collapse the sidebar and verify the title/subtitle/toolbar clear the traffic lights and shell controls; repeat in fullscreen and at a narrow width.

The host unit and bridge tests run against rc.2 with fake entries; the GUI smoke is the only real-native check.

## Risks / Trade-offs

- [Private entry ids or prop shapes change in a DSH update] -> Pin rc.2, assert the three ids and prop wiring in the host test, and hide the row with no fallback if they are absent. A DSH update may require a plugin change.
- [Bypassing the slot renderer loses its error boundary and assembly safeguards] -> The host reproduces the relevant assembly and wraps each action in its own boundary.
- [The native action components rely on a future renderer context] -> The three current components receive everything through props; the host test and GUI smoke verify.
- [Locale changes do not re-render the host immediately] -> `SessionStatus` subscribes to the locale revision and binds `t` from the locale service, so the native labels refresh.
- [The mode is read-only; no picker] -> Accepted scope. Mode selection remains outside this change and is not implied by the label.
- [The board header clearance is desktop-only and not covered by the browser smoke] -> CSS token check plus manual desktop verification at collapsed, fullscreen, and narrow widths.
- [The host may render actions for a blank session] -> That is acceptable; the native actions hide themselves when they have nothing, and the native mode label is read-only.
- [No DSH change means no stable extension point] -> Contained private module, pinned host, and a GUI smoke. The supported public-factory path remains a future option.

## Migration Plan

1. Add the locale dev dependency and client injection; install at the existing rc.2 pin.
2. Add the native action host and its unit tests.
3. Add the `kanban.session.status` slot, frame, row, and conversation-area refactor.
4. Add the board header clearance rule and token check.
5. Update the README with the private host, the read-only mode, the pinned host, and the header behavior.
6. Run typecheck/tests/check; run the opt-in GUI smoke and the desktop collapsed-sidebar check.

Rollback: revert the plugin commit; the DSH packages and host are untouched.

## Open Questions

- None affecting the specs or approach. The exact visual spacing of the row is tuned during implementation; the host's private entry contract is pinned to rc.2.
