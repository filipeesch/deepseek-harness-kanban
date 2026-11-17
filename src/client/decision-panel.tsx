import React, { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { Column, Problem, Task } from '../shared/types.js';
import { ChoiceOptions, Markdown } from '../questions/choice-slide.js';
import { questionCss } from '../questions/styles.js';
import { DECISION_LIMITS } from '../domain/decision-definition.js';
import { decisionLabel } from './decision-view.js';
import { DecisionWindowController, type DecisionWindowEntry } from './decision-window.js';

/** The drawer's own styling; the shared question styles keep the composer's widths. */
const decisionCss = String.raw`
.dsh-kanban .kb-decision{flex:none;padding:8px 14px 0;border-bottom:0.5px solid var(--kb-line);min-width:0}
.dsh-kanban .kb-decision .kq-strip{width:100%;max-width:none;margin:0;box-shadow:none;border-radius:var(--dsw-radius-md,8px)}
.dsh-kanban .kb-decision .kq-scroll{max-height:46vh}
.dsh-kanban .kb-decision .kq-desc{min-height:56px;max-height:140px}
.dsh-kanban .kb-decision-observation{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,currentColor)}
.dsh-kanban .kb-decision-observation .kq-input{border:1px solid var(--dsw-alias-border-l2,var(--kb-line));background:var(--dsw-alias-bg-base,var(--kb-surface))}
.dsh-kanban .kq-collapsed-status{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid var(--kb-line);font-size:12px;color:var(--dsw-alias-label-secondary,currentColor)}
.dsh-kanban .kq-collapsed-status p{margin:0;flex:1 1 auto}
.dsh-kanban .kb-decision-footer-note{margin:0;flex:1 1 auto;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-tertiary,currentColor)}
`;

const EMPTY_ENTRIES: Record<string, DecisionWindowEntry> = {};
const NO_SUBSCRIBE = () => () => {};
const getEmptyEntries = () => EMPTY_ENTRIES;

/** Subscribe to one task's window; the entry is undefined once the window settles. */
export function useDecisionWindowEntry(controller: DecisionWindowController | undefined, taskId: string): DecisionWindowEntry | undefined {
  const snapshot = useSyncExternalStore(controller?.subscribe ?? NO_SUBSCRIBE, controller?.getSnapshot ?? getEmptyEntries, controller?.getSnapshot ?? getEmptyEntries);
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

/**
 * The decision gate docked above the drawer's sections.
 *
 * It is the same presentation as the structured-question surface, resolved from
 * the stage the task sits in. Confirming starts the cancelable five-second window;
 * the panel keeps the choice while the window counts, and presents the host's
 * refusal when the route could not be applied.
 */
export function DecisionPanel({ task, column, columns, controller, stageIdentities }: { task: Task; column: Column | undefined; columns: readonly Column[]; controller: DecisionWindowController; stageIdentities?: Readonly<Record<string, string>> }) {
  const prefix = useId();
  const decision = column?.decision;
  const entry = useDecisionWindowEntry(controller, task.id);
  const [selectedId, setSelectedId] = useState('');
  const [focusId, setFocusId] = useState('');
  const [note, setNote] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const counting = entry?.status === 'counting';
  useTicking(counting);
  // A renamed or removed option must not stay selected.
  useEffect(() => {
    if (decision === undefined || selectedId.length === 0) return;
    if (!decision.options.some(option => option.id === selectedId)) { setSelectedId(''); setFocusId(''); }
  }, [decision, selectedId]);
  if (decision === undefined) return null;
  const options = decision.options;
  const busy = entry?.status === 'counting' || entry?.status === 'sending';
  const error = entry?.status === 'failed' ? errorText(entry.error ?? { code: 'DECISION_FAILED', message: 'The choice could not be applied.' }) : draftError;
  const confirm = (): void => {
    if (selectedId.length === 0 || busy) return;
    const option = options.find(value => value.id === selectedId);
    if (option === undefined) return;
    setDraftError(null);
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
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    confirm();
  };
  return <div className="kb-decision" aria-label="Decision">
    <style>{questionCss}</style>
    <style>{decisionCss}</style>
    <form className="kq-strip" aria-label={decisionLabel(options.length)} onSubmit={submit}>
      <button type="button" className="kq-header" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        <span className="kq-icon"><DecisionGlyph /></span>
        <span className="kq-title">{decisionLabel(options.length)}</span>
        <span className="kq-progress" aria-live="polite">{counting ? remainingSeconds(entry?.deadline ?? null) + 's' : ''}</span>
        <span className="kq-chevron" data-open={!collapsed}><Chevron up={!collapsed} /></span>
      </button>
      {collapsed && (counting || entry?.status === 'sending' || entry?.status === 'failed') && <div className="kq-collapsed-status">
        {counting && <p role="status">Moving to {entry?.destinationName} in {remainingSeconds(entry?.deadline ?? null)} seconds.</p>}
        {entry?.status === 'sending' && <p role="status">Applying…</p>}
        {entry?.status === 'failed' && <p role="alert">{error}</p>}
        {counting && <button type="button" className="kq-secondary" onClick={() => controller.cancel(task.id)}>Cancel</button>}
      </div>}
      {!collapsed && <div className="kq-panel">
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
              onFocus={setFocusId}
              onSelect={(value, checked) => { if (checked) { setSelectedId(value); setFocusId(value); } }}
            />
            <label className="kb-decision-observation">Observation (optional)
              <textarea className="kq-input" aria-label="Observation" maxLength={DECISION_LIMITS.noteLength} value={note} disabled={busy} onChange={event => setNote(event.target.value)} />
            </label>
          </section>
          {error !== null && <p className="kq-error" role="alert">{error}</p>}
        </div>
        <footer className="kq-footer">
          {counting && <p className="kb-decision-footer-note" role="status">Moving to {entry?.destinationName} in {remainingSeconds(entry?.deadline ?? null)} seconds. The task stays here until the window closes.</p>}
          <div className="kq-footer-actions">
            {counting && <button type="button" className="kq-secondary" onClick={() => controller.cancel(task.id)}>Cancel</button>}
            <button type="submit" className="kq-primary" disabled={selectedId.length === 0 || busy}>{entry?.status === 'sending' ? 'Applying…' : 'Confirm choice'}</button>
          </div>
        </footer>
      </div>}
    </form>
  </div>;
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