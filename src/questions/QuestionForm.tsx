import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import type { QuestionAnswer, QuestionRound } from '../shared/types.js';
import { OTHER_CHOICE, answerFor, emptyAnswer, formatAnswers, isAnswerValid } from './validation.js';

export interface QuestionFormProps {
  round: QuestionRound;
  onSubmit(text: string): void | Promise<void>;
  onDismiss(): void;
}
interface Draft {
  roundId: string;
  currentCallId?: string;
  answers: Record<string, QuestionAnswer>;
  generalNotes: string;
  submitting: boolean;
  submitted: boolean;
  error: string | null;
}
function newDraft(roundId: string): Draft {
  return { roundId, answers: Object.create(null) as Record<string, QuestionAnswer>, generalNotes: '', submitting: false, submitted: false, error: null };
}
function Markdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml disallowedElements={['img']}>{text}</ReactMarkdown>;
}

/** An optional answer composer. It never owns or cancels a native question interaction. */
export function QuestionForm({ round, onSubmit, onDismiss }: QuestionFormProps) {
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => newDraft(round.id));
  const inFlight = useRef(new Set<string>());
  const sent = useRef(new Set<string>());
  useEffect(() => { setDraft(previous => previous.roundId === round.id ? previous : newDraft(round.id)); }, [round.id]);
  const current = draft.roundId === round.id ? draft : newDraft(round.id);
  const selectedIndex = current.currentCallId ? round.pages.findIndex(page => page.callId === current.currentCallId) : 0;
  const index = selectedIndex < 0 ? 0 : selectedIndex;
  const entry = round.pages[index];
  const answer = entry ? answerFor(current.answers, entry.callId) ?? emptyAnswer() : emptyAnswer();
  const disabled = round.answered || current.submitting || current.submitted || sent.current.has(round.id);
  const valid = round.pages.length > 0 && round.pages.every(page => isAnswerValid(page.page, answerFor(current.answers, page.callId)));
  const canSubmit = round.complete && !disabled && valid;
  const questionId = prefix + '-question';

  function updateDraft(update: (previous: Draft) => Draft) {
    setDraft(previous => update(previous.roundId === round.id ? previous : newDraft(round.id)));
  }
  function updateAnswer(update: (previous: QuestionAnswer) => QuestionAnswer) {
    if (!entry) return;
    updateDraft(previous => ({ ...previous, currentCallId: entry.callId, error: null,
      answers: { ...previous.answers, [entry.callId]: update(answerFor(previous.answers, entry.callId) ?? emptyAnswer()) } }));
  }
  function choose(value: string, checked: boolean) {
    if (!entry) return;
    updateAnswer(previous => ({ ...previous,
      choices: entry.page.type === 'exclusive' ? [value] : checked ? [...previous.choices.filter(choice => choice !== value), value] : previous.choices.filter(choice => choice !== value),
    }));
  }
  function navigate(next: number) {
    const page = round.pages[next];
    if (page) updateDraft(previous => ({ ...previous, currentCallId: page.callId }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || inFlight.current.has(round.id) || sent.current.has(round.id)) return;
    const roundId = round.id;
    inFlight.current.add(roundId);
    updateDraft(previous => ({ ...previous, submitting: true, error: null }));
    try {
      const text = formatAnswers(round, current.answers, current.generalNotes);
      await onSubmit(text);
      sent.current.add(roundId);
      setDraft(previous => previous.roundId === roundId ? { ...previous, submitting: false, submitted: true } : previous);
    } catch (error) {
      setDraft(previous => previous.roundId === roundId ? { ...previous, submitting: false, error: error instanceof Error ? error.message : String(error) } : previous);
    } finally { inFlight.current.delete(roundId); }
  }

  return <form className="kanban-question-form" aria-label="Questions from the agent" onSubmit={submit}>
    <header className="kanban-question-form-header">
      <h2>Questions from the agent</h2>
      <button type="button" aria-label="Close question form" onClick={onDismiss}>Close</button>
    </header>
    {!round.complete && <p role="status">More questions may arrive. You can start answering now.</p>}
    {round.answered && <p role="status">This round has been answered in the conversation.</p>}
    {current.submitted && <p role="status">Response submitted.</p>}
    {entry ? <section aria-labelledby={questionId}>
      <p aria-live="polite">Question {index + 1} of {round.pages.length}</p>
      {entry.page.context && <div className="kanban-question-context"><Markdown text={entry.page.context} /></div>}
      <div id={questionId} role="heading" aria-level={3}><Markdown text={entry.page.question} /></div>
      {entry.page.weight && <p className="kanban-question-weight">Importance: {entry.page.weight}</p>}
      {entry.page.model_lean && <aside aria-label="Agent recommendation">
        <strong>Recommended: {entry.page.model_lean}</strong>
        {entry.page.model_lean_reason && <Markdown text={entry.page.model_lean_reason} />}
      </aside>}
      {entry.page.type === 'freetext' ? <label>Your answer
        <textarea aria-label="Your answer" value={answer.text} disabled={disabled} onChange={event => updateAnswer(previous => ({ ...previous, text: event.target.value }))} />
      </label> : <fieldset disabled={disabled}>
        <legend>{entry.page.type === 'exclusive' ? 'Choose one answer' : 'Choose one or more answers'}</legend>
        {(entry.page.options ?? []).map((option, optionIndex) => <div className="kanban-question-option" key={option.title}>
          <label htmlFor={prefix + '-option-' + optionIndex}>
            <input id={prefix + '-option-' + optionIndex} type={entry.page.type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices'}
              checked={answer.choices.includes(option.title)} onChange={event => choose(option.title, event.target.checked)} />
            {option.title}
          </label>
          <div className="kanban-question-option-description"><Markdown text={option.description} /></div>
        </div>)}
        <label htmlFor={prefix + '-other'}>
          <input id={prefix + '-other'} type={entry.page.type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices'}
            checked={answer.choices.includes(OTHER_CHOICE)} onChange={event => choose(OTHER_CHOICE, event.target.checked)} />
          Other (write your own answer)
        </label>
        {answer.choices.includes(OTHER_CHOICE) && <label>Other answer
          <textarea aria-label="Other answer" value={answer.other} onChange={event => updateAnswer(previous => ({ ...previous, other: event.target.value }))} />
        </label>}
      </fieldset>}
      <label>Notes for this answer
        <textarea aria-label="Notes for this answer" value={answer.notes} disabled={disabled} onChange={event => updateAnswer(previous => ({ ...previous, notes: event.target.value }))} />
      </label>
      {index === round.pages.length - 1 && <label>Additional context for this round
        <textarea aria-label="Additional context for this round" value={current.generalNotes} disabled={disabled}
          onChange={event => updateDraft(previous => ({ ...previous, generalNotes: event.target.value }))} />
      </label>}
    </section> : <p>Waiting for question pages.</p>}
    {current.error && <p role="alert">{current.error}</p>}
    <footer>
      <button type="button" onClick={() => navigate(index - 1)} disabled={index === 0}>Back</button>
      {index < round.pages.length - 1
        ? <button type="button" onClick={() => navigate(index + 1)}>Next</button>
        : <button type="submit" disabled={!canSubmit}>{current.submitting ? 'Submitting…' : 'Submit answers'}</button>}
    </footer>
  </form>;
}
