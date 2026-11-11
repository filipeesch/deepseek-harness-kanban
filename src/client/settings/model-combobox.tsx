import React, { useId, useMemo, useRef, useState } from 'react';
import type { ModelCatalog, ModelSelection } from '../../shared/types.js';
import { modelKey } from '../../domain/model-preference.js';
import { CheckSquareIcon, ChevronRightIcon } from '../icons.js';
import { Popover, type PopoverHandle } from '../popover.js';
import { HOST_DEFAULT_MODEL, filterModelRows, modelOptionValue, modelRowOf, modelRows, type ModelRow } from './model-options.js';

export interface ModelComboboxProps {
  /** The stored route; absent means the deployment default. */
  value: ModelSelection | undefined;
  /** The live catalog, or null when the host could not be asked for one. */
  catalog: ModelCatalog | null | undefined;
  /** Called with the next route, or with undefined to fall back to the deployment default. */
  onChange: (selection: ModelSelection | undefined) => void;
  /** Whether the control is busy. */
  disabled?: boolean;
  /** Re-read the catalog from the host; the reload affordance appears only when supplied. */
  refresh?: () => void;
}

/**
 * Pick a model route the way DSH's own picker does: one closed control that names
 * the current route, and a searchable list of providers and models behind it.
 *
 * The host's composer selector is a per-session seat and writes a conversation's
 * model, so it cannot be borrowed for a board or a schedule document. This keeps
 * its interaction model — search, grouped rows, keyboard movement, the current row
 * marked — over data the caller already owns, and leaves what the choice *means*
 * with the surface that renders it.
 */
export function ModelCombobox({ value, catalog, onChange, disabled = false, refresh }: ModelComboboxProps) {
  const popover = useRef<PopoverHandle>(null);
  const id = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rows = useMemo(() => modelRows(catalog, value), [catalog, value]);
  const visible = useMemo(() => filterModelRows(rows, query), [rows, query]);
  const current = modelRowOf(catalog, value);
  const currentValue = modelOptionValue(value);
  const listId = id + '-list';
  const optionId = (index: number) => listId + '-' + index;
  // The filtered list can shrink under the highlight; clamp rather than reset so
  // typing one more character keeps the row the person was arrowing towards.
  const activeIndex = visible.length === 0 ? -1 : Math.min(active, visible.length - 1);

  function choose(row: ModelRow): void {
    const next = row.value === HOST_DEFAULT_MODEL ? undefined : row.selection;
    // Re-choosing the stored route keeps its effort; any other route starts without one.
    onChange(next !== undefined && modelKey(next) === currentValue ? value : next);
    popover.current?.close(true);
  }

  function open(): void {
    setQuery('');
    setActive(Math.max(0, visible.findIndex(row => row.value === currentValue)));
  }

  function move(delta: number): void {
    if (visible.length === 0) return;
    setActive(Math.min(visible.length - 1, Math.max(0, activeIndex + delta)));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
    if (event.key === 'Home') { event.preventDefault(); setActive(0); return; }
    if (event.key === 'End') { event.preventDefault(); setActive(visible.length - 1); return; }
    // Enter inside the form would save it: the highlighted row is what Enter means here.
    if (event.key === 'Enter') {
      event.preventDefault();
      const row = visible[activeIndex];
      if (row !== undefined) choose(row);
    }
  }

  // One heading per group, in catalog order, with the neutral option standing alone.
  const groups: Array<{ name: string; items: Array<{ row: ModelRow; index: number }> }> = [];
  visible.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === row.group) last.items.push({ row, index });
    else groups.push({ name: row.group, items: [{ row, index }] });
  });

  return <Popover
    ref={popover}
    label="Choose the model"
    triggerClassName="kb-input kb-model-trigger"
    triggerLabel={'Model: ' + current.title}
    triggerDisabled={disabled}
    align="start"
    popoverClassName="kb-model-popover"
    initialFocusSelector=".kb-model-popover input[type=search]"
    onOpen={open}
    trigger={<>
      <span className="kb-model-trigger-text">{current.title}</span>
      <ChevronRightIcon size={14} />
    </>}
  >
    <input
      className="kb-input"
      type="search"
      role="combobox"
      aria-label="Search models"
      aria-expanded="true"
      aria-controls={listId}
      aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
      placeholder="Search models"
      value={query}
      onChange={event => { setQuery(event.target.value); }}
      onKeyDown={onKeyDown}
    />
    {/* The caller says why the catalog is missing; this says only what that leaves here. */}
    {catalog === null && <p className="kb-hint" role="status">Only the stored route is listed{refresh === undefined ? '.' : '. Reload the catalog to see every route.'}</p>}
    <div className="kb-model-list" id={listId} role="listbox" aria-label="Models">
      {visible.length === 0 && <p className="kb-hint" role="status">No model matches “{query}”.</p>}
      {groups.map(group => group.name === ''
        ? group.items.map(({ row, index }) => <ModelOption key={row.value} row={row} id={optionId(index)} active={index === activeIndex} current={row.value === currentValue} onChoose={choose} onPoint={() => setActive(index)} />)
        : <div className="kb-model-group" role="group" aria-label={group.name} key={group.name}>
          <p className="kb-model-group-label">{group.name}</p>
          {group.items.map(({ row, index }) => <ModelOption key={row.value} row={row} id={optionId(index)} active={index === activeIndex} current={row.value === currentValue} onChoose={choose} onPoint={() => setActive(index)} />)}
        </div>)}
    </div>
    {refresh !== undefined && <div className="kb-model-footer">
      <button type="button" className="kb-button" disabled={disabled} onClick={refresh}>Reload models</button>
    </div>}
  </Popover>;
}

/** One route row: the label, its provider, and whether it is the stored route. */
function ModelOption({ row, id, active, current, onChoose, onPoint }: {
  row: ModelRow;
  id: string;
  active: boolean;
  current: boolean;
  onChoose: (row: ModelRow) => void;
  onPoint: () => void;
}) {
  return <button
    type="button"
    id={id}
    role="option"
    aria-selected={current}
    tabIndex={-1}
    className={'kb-model-option' + (active ? ' is-active' : '') + (current ? ' is-current' : '')}
    onClick={() => onChoose(row)}
    onMouseEnter={onPoint}
    title={row.title}
  >
    <span className="kb-model-option-text">
      <span className="kb-model-option-label">{row.label}</span>
      <span className="kb-model-option-detail">{row.detail}</span>
    </span>
    {current && <CheckSquareIcon size={14} />}
  </button>;
}
