import React from 'react';
import type { BoardNotice } from './model.js';
import { DismissButton } from './dismiss-button.js';

/**
 * One board notice. The dismiss control is the only interactive element the row adds
 * beyond the notice's own actions; a notice without a dismissal renders without it.
 */
export function NoticeRow({ notice, onDismiss, role }: {
  notice: BoardNotice;
  /** Receives the dismiss control so the caller can hand focus to the next notice. */
  onDismiss?: (notice: BoardNotice, control: HTMLButtonElement) => void;
  role?: 'alert' | 'status';
}) {
  const dismissible = notice.dismiss !== undefined;
  return <div className={'kb-notice-row' + (notice.tone === 'failure' ? ' kb-notice-row-failure' : '') + (dismissible ? ' kb-notice-row-dismissible' : '')} role={role}>
    <div className="kb-notice-body">
      {notice.title !== undefined && <strong className="kb-notice-title">{notice.title}</strong>}
      {notice.segments.length > 0 && <p className="kb-notice-message">{notice.segments.map((segment, index) => 'code' in segment
        ? <code key={index}>{segment.code}</code>
        : <React.Fragment key={index}>{segment.text}</React.Fragment>)}</p>}
      {notice.items !== undefined && notice.items.length > 0 && <ul className="kb-batch-list">{notice.items.map(item => <li key={item.id}><button type="button" className="kb-link-button" onClick={item.run}>{item.label}</button>{item.suffix === undefined ? null : ' — ' + item.suffix}</li>)}</ul>}
      {notice.hint !== undefined && <p className="kb-hint">{notice.hint}</p>}
      {notice.actions.length > 0 && <div className="kb-actions">{notice.actions.map(action => <button
        key={action.id}
        type="button"
        className={'kb-button' + (action.tone === 'danger' ? ' kb-danger' : '')}
        onClick={action.run}
      >{action.label}</button>)}</div>}
    </div>
    {notice.dismiss !== undefined && <DismissButton
      label={notice.dismiss.label}
      hint={notice.dismiss.hint}
      onDismiss={control => { notice.dismiss!.run(); onDismiss?.(notice, control); }}
    />}
  </div>;
}
