import React, { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Column, DecisionDefinition, Problem, Task } from '../shared/types.js';
import { ChoiceOptions, Markdown } from '../questions/choice-slide.js';
import { questionCss } from '../questions/styles.js';
import { useDockLauncher } from '../questions/launcher-state.js';
import { DECISION_LIMITS } from '../domain/decision-definition.js';
import { decisionLabel } from './decision-view.js';
import { DecisionWindowController, type DecisionWindowEntry } from './decision-window.js';

const EMPTY_ENTRIES: Record<string, DecisionWindowEntry> = {};
const NO_SUBSCRIBE = () => () => {};
const getEmptyEntries = () => EMPTY_ENTRIES;

/** Subscribe to one task's window; the entry is undefined once the window settles. */
export function useDecisionWindowEntry(controller: DecisionWindowController | undefined, taskId: string): DecisionWindowEntry | undefined {
  const snapshot = React.useSyncExternalStore(controller?.subscribe ?? NO_SUBSCRIBE, controller?.getSnapshot ?? getEmptyEntries, controller?.getSnapshot ?? getEmptyEntries);
  return snapshot[taskId];
}

/** Re-render while a countdown is running, so its remaining seconds stay truthful. */
function useTicking(active: boolean): void {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => force(value => value + 1), 250);
    return () => window.clearInterval(timer);
  }, [active]);
}

function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function DecisionGlyph() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M8 2.2 14 13H2L8 2.2Z" /><path d="M8 6.4v3.1" /><circle cx="8" cy="11.2" r=".7" fill="currentColor" stroke="none" /></svg>;
}

function Chevron({ up }: { up: boolean }) {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} /></svg>;
}

function errorText(problem: Problem): string {
  return problem.message;
}

/** Everything the gate presents, with no controller and no task: the strip is the whole surface. */
export interface DecisionGateProps {
  /** The authored decision the stage carries. */
  decision: DecisionDefinition;
  /** The option identity the person selected, or an empty string while nothing is selected. */
  selectedId: string;
  /** The option whose row holds keyboard focus, so its row keeps the focus style. */
  focusId: string;
  /** The observation the person typed; plain text. */
  note: string;
  collapsed: boolean;
  /** The window the shared controller holds for the task this gate belongs to. */
  entry?: DecisionWindowEntry;
  /** A refusal to present beside the retained selection and observation. */
  error?: string | null;
  onToggleCollapsed: () => void;
  onSelect: (optionId: string) => void;
  onFocus: (optionId: string) => void;
  onNote: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The decision gate's presentation.
 *
 * It is the same strip the structured-question surface draws, resolved from the
 * stage the task sits in. It owns no state and no controller: the composer dock
 * above it holds the selection, and the shared window controller holds the
 * countdown.
 */
export function DecisionGate({ decision, selectedId, focusId, note, collapsed, entry, error = null, onToggleCollapsed, onSelect, onFocus, onNote, onConfirm, onCancel }: DecisionGateProps) {
  const prefix = useId();
  const options = decision.options;
  // The launcher presentation opens one strip at a time. It never rewrites the person's
  // disclosure choice: with the ordinary layout back, the gate returns to it.
  const launcher = useDockLauncher();
  const [launcherCollapsed, setLauncherCollapsed] = useState(false);
  useEffect(() => { setLauncherCollapsed(false); }, [launcher.active]);
  const panelVisible = launcher.launcher ? launcher.active && !launcherCollapsed : !collapsed;
  const toggle = (): void => {
    if (launcher.launcher) { if (launcher.active) setLauncherCollapsed(value => !value); return; }
    onToggleCollapsed();
  };
  const counting = entry?.status === 'counting';
  const busy = entry?.status === 'counting' || entry?.status === 'sending';
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onConfirm();
  };
  return <div className="kb-decision" aria-label="Decision">
    <style>{questionCss}</style>
    <form className="kq-strip" aria-label={decisionLabel(options.length)} onSubmit={submit}>
      <div className="kq-header-row">
        <button type="button" className="kq-header" aria-expanded={panelVisible} onClick={toggle}>
          <span className="kq-icon"><DecisionGlyph /></span>
          <span className="kq-title">{decisionLabel(options.length)}</span>
          <span className="kq-progress" aria-live="polite">{counting ? remainingSeconds(entry?.deadline ?? null) + 's' : ''}</span>
          <span className="kq-chevron" data-open={panelVisible}><Chevron up={panelVisible} /></span>
        </button>
        {/* The cancel action lives in the header, which stays pinned even when the strip scrolls. */}
        {counting && <button type="button" className="kq-secondary kq-header-cancel" onClick={onCancel}>Cancel</button>}
      </div>
      {!panelVisible && (counting || entry?.status === 'sending' || entry?.status === 'failed') && <div className="kq-collapsed-status">
        {counting && <p role="status">Moving to {entry?.destinationName} in {remainingSeconds(entry?.deadline ?? null)} seconds.</p>}
        {entry?.status === 'sending' && <p role="status">Applying…</p>}
        {entry?.status === 'failed' && <p role="alert">{error}</p>}
      </div>}
      {panelVisible && <div className="kq-panel">
        <div className="kq-scroll">
          {decision.context !== undefined && <div className="kq-context"><Markdown text={decision.context} /></div>}
          <section className="kq-slide">
            <div className="kq-question-head">
              <div className="kq-question" role="heading" aria-level={3}><Markdown text={decision.question} /></div>
            </div>
            <ChoiceOptions
              prefix={prefix}
              callId="decision"
              type="exclusive"
              options={options.map(option => ({ title: option.title, description: option.description ?? '', value: option.id }))}
              selected={selectedId.length === 0 ? [] : [selectedId]}
              disabled={busy}
              focus={focusId}
              legend={options.length === 1 ? 'Confirm to continue' : 'Choose one path'}
              onFocus={onFocus}
              onSelect={(value, checked) => { if (checked) onSelect(value); }}
            />
            <label className="kq-field">Observation (optional)
              <textarea className="kq-input" aria-label="Observation" maxLength={DECISION_LIMITS.noteLength} value={note} disabled={busy} onChange={event => onNote(event.target.value)} />
            </label>
          </section>
        </div>
        <footer className="kq-footer">
          {/* A refusal belongs beside the action: below the folding body it could be invisible. */}
          {error !== null && <p className="kq-error" role="alert">{error}</p>}
          {counting && <p className="kq-confirm-text" role="status">Moving to {entry?.destinationName} in {remainingSeconds(entry?.deadline ?? null)} seconds. The task stays here until the window closes.</p>}
          <div className="kq-footer-actions">
            <button type="submit" className="kq-primary" disabled={selectedId.length === 0 || busy}>{entry?.status === 'sending' ? 'Applying…' : 'Confirm choice'}</button>
          </div>
        </footer>
      </div>}
    </form>
  </div>;
}

/** What the gate's host supplies: the task, its stage, and the shared window. */
export interface DecisionPanelProps {
  task: Task;
  column: Column | undefined;
  columns: readonly Column[];
  controller: DecisionWindowController;
  /** Local stage identities, so a choice names the destination the person saw. */
  stageIdentities?: Readonly<Record<string, string>>;
}

/**
 * The decision gate wired to the board.
 *
 * The draft belongs to one stage entry: a task that leaves a gate and enters
 * another one starts a new unanswered draft even when the options reuse their
 * identities. Every conversation of the task renders its own container, so the
 * draft is per surface and the answer being applied is read from the one shared
 * window.
 */
export function DecisionPanel(props: DecisionPanelProps) {
  const entryId = props.task.stageEntry?.id ?? props.task.columnId;
  return <DecisionDraft key={props.task.id + ':' + entryId} {...props} />;
}

function DecisionDraft({ task, column, columns, controller, stageIdentities }: DecisionPanelProps) {
  const decision = column?.decision;
  const entry = useDecisionWindowEntry(controller, task.id);
  const [selectedId, setSelectedId] = useState('');
  const [focusId, setFocusId] = useState('');
  const [note, setNote] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const counting = entry?.status === 'counting';
  useTicking(counting);
  // The task's answer is shared: when another conversation confirms (or the window
  // records a refusal), this surface adopts the option and the observation the one
  // window holds, so two conversations never present different answers. Adopting
  // once per entry value also leaves the person free to edit after a refusal.
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (entry === undefined) { adopted.current = null; return; }
    // One attempt, one adoption: an identical retry is a new attempt, and editing after a
    // refusal never re-adopts over what the person typed.
    const identity = entry.entryId + ':' + entry.attempt;
    if (adopted.current === identity) return;
    adopted.current = identity;
    setSelectedId(entry.optionId);
    setFocusId(entry.optionId);
    setNote(entry.note ?? '');
  }, [entry]);
  // A renamed or removed option must not stay selected.
  useEffect(() => {
    if (decision === undefined || selectedId.length === 0) return;
    if (!decision.options.some(option => option.id === selectedId)) { setSelectedId(''); setFocusId(''); }
  }, [decision, selectedId]);
  if (decision === undefined) return null;
  const busy = entry?.status === 'counting' || entry?.status === 'sending';
  // While a choice is being applied, every conversation presents that choice from the
  // shared window — not its own draft, which may hold a different option or a refusal retry.
  const applying = busy;
  const shownSelection = applying && entry !== undefined ? entry.optionId : selectedId;
  const shownNote = applying && entry !== undefined ? entry.note ?? '' : note;
  const error = entry?.status === 'failed' ? errorText(entry.error ?? { code: 'DECISION_FAILED', message: 'The choice could not be applied.' }) : null;
  const confirm = (): void => {
    if (selectedId.length === 0 || busy) return;
    const option = decision.options.find(value => value.id === selectedId);
    if (option === undefined) return;
    const destination = columns.find(value => value.id === option.to);
    controller.arm({
      taskId: task.id,
      entryId: task.stageEntry?.id ?? '',
      optionId: option.id,
      ...(note.trim().length === 0 ? {} : { note: note.trim() }),
      destinationId: option.to,
      destinationIdentity: stageIdentities?.[option.to] ?? destination?.key ?? option.to,
      destinationName: destination?.name ?? option.to,
    });
  };
  return <DecisionGate
    decision={decision}
    selectedId={shownSelection}
    focusId={applying && entry !== undefined ? entry.optionId : focusId}
    note={shownNote}
    collapsed={collapsed}
    {...(entry === undefined ? {} : { entry })}
    error={error}
    onToggleCollapsed={() => setCollapsed(value => !value)}
    onSelect={value => { setSelectedId(value); setFocusId(value); }}
    onFocus={setFocusId}
    onNote={setNote}
    onConfirm={confirm}
    onCancel={() => controller.cancel(task.id)}
  />;
}

/** The card's countdown while the five-second window is open. */
export function DecisionCountdown({ entry, onCancel }: { entry: DecisionWindowEntry; onCancel: () => void }) {
  const counting = entry.status === 'counting';
  useTicking(counting);
  if (!counting) return null;
  const remaining = remainingSeconds(entry.deadline);
  return <button
    type="button"
    className="kb-card-countdown"
    aria-label={'Moving to ' + entry.destinationName + ' in ' + remaining + ' seconds. Cancel'}
    title={'Moving to ' + entry.destinationName + ' in ' + remaining + ' seconds. Cancel'}
    onClick={event => { event.stopPropagation(); onCancel(); }}
    onPointerDown={event => event.stopPropagation()}
  >
    <span className="kb-countdown-label">{entry.destinationName} · {remaining}s</span>
    <span className="kb-countdown-cancel" aria-hidden="true">×</span>
    <span className="kb-countdown-bar" style={{ width: (remaining / 5) * 100 + '%' }} aria-hidden="true" />
  </button>;
}
