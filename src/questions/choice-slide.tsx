import React from 'react';
import ReactMarkdown from 'react-markdown';
import { OTHER_CHOICE } from './validation.js';

/**
 * The presentation the structured-question surface and the decision gate share.
 *
 * Both surfaces render authored Markdown and a choice list with an explanatory
 * pane; keeping the markup here means the two cannot drift in appearance,
 * accessibility, or the way an option's description is read.
 */

export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml disallowedElements={['img']}>{text}</ReactMarkdown>;
}

export interface ChoiceOptionView {
  readonly title: string;
  readonly description: string;
  /** The value the choice reports; a title when the surface uses titles as identity. */
  readonly value?: string;
}

export interface ChoiceOther { readonly text: string; readonly active: boolean }

export interface ChoiceOptionsProps {
  /** Prefix for the control ids, so several lists on one page never collide. */
  readonly prefix: string;
  /** Identity the controls share inside one question. */
  readonly callId: string;
  readonly type: 'exclusive' | 'non_exclusive';
  readonly options: readonly ChoiceOptionView[];
  readonly selected: readonly string[];
  readonly disabled: boolean;
  /** The option whose description is presented; an empty value shows the hint. */
  readonly focus: string;
  /** The option a recommendation names, if any. */
  readonly lean?: string;
  /** Present when the list offers the Other answer. */
  readonly other?: ChoiceOther;
  readonly legend?: string;
  readonly onFocus: (value: string) => void;
  readonly onSelect: (value: string, checked: boolean) => void;
  readonly onOtherText?: (value: string) => void;
}

function valueOf(option: ChoiceOptionView): string {
  return option.value ?? option.title;
}

function descriptionFor(options: readonly ChoiceOptionView[], value: string): string {
  return options.find(option => valueOf(option) === value)?.description ?? '';
}

/** One choice list, its Other answer, and the pane that explains the focused option. */
export function ChoiceOptions({ prefix, callId, type, options, selected, disabled, focus, lean, other, legend, onFocus, onSelect, onOtherText }: ChoiceOptionsProps) {
  const otherActive = other !== undefined && (selected.includes(OTHER_CHOICE) || focus === OTHER_CHOICE);
  const choose = (value: string, checked: boolean) => {
    if (disabled) return;
    onFocus(value);
    onSelect(value, checked);
  };
  return <>
    <fieldset className="kq-options" disabled={disabled}>
      <legend>{legend ?? (type === 'exclusive' ? 'Choose one answer' : 'Choose one or more answers')}</legend>
      {options.map((option, optionIndex) => {
        const value = valueOf(option);
        const checked = selected.includes(value);
        return <div key={value} className="kq-option" data-focused={focus === value} data-selected={checked}
          onClick={() => { if (disabled) return; onFocus(value); if (type === 'exclusive') choose(value, true); }}>
          <input id={prefix + '-option-' + optionIndex} type={type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices-' + callId}
            checked={checked} disabled={disabled} onChange={event => choose(value, event.target.checked)} onFocus={() => onFocus(value)} />
          <label htmlFor={prefix + '-option-' + optionIndex} className="kq-option-title">{option.title}</label>
          {lean === option.title && <span className="kq-ai">AI suggests</span>}
        </div>;
      })}
      {other !== undefined && <div className="kq-option" data-focused={focus === OTHER_CHOICE} data-selected={selected.includes(OTHER_CHOICE)}
        onClick={() => { if (disabled) return; onFocus(OTHER_CHOICE); if (type === 'exclusive') choose(OTHER_CHOICE, true); }}>
        <input id={prefix + '-other'} type={type === 'exclusive' ? 'radio' : 'checkbox'} name={prefix + '-choices-' + callId}
          checked={selected.includes(OTHER_CHOICE)} disabled={disabled} onChange={event => choose(OTHER_CHOICE, event.target.checked)} onFocus={() => onFocus(OTHER_CHOICE)} />
        <label htmlFor={prefix + '-other'} className="kq-option-title">Other (write your own answer)</label>
      </div>}
    </fieldset>
    {otherActive && other !== undefined
      ? <div className="kq-desc" data-other="true"><textarea className="kq-input" data-fill="true" aria-label="Other answer" value={other.text} disabled={disabled} onChange={event => onOtherText?.(event.target.value)} /></div>
      : focus
        ? (descriptionFor(options, focus).trim().length > 0
          ? <div className="kq-desc"><div className="kq-desc-body"><Markdown text={descriptionFor(options, focus)} /></div></div>
          : null)
        : <div className="kq-desc"><p className="kq-desc-empty">Select an option to see details.</p></div>}
  </>;
}