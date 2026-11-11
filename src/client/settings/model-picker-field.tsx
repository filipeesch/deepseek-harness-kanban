import React from 'react';
import type { ModelCatalog, ModelSelection } from '../../shared/types.js';
import { ModelCombobox } from './model-combobox.js';
import { modelEffortOptions } from './model-options.js';

export type { ModelRow } from './model-options.js';
export {
  HOST_DEFAULT_MODEL,
  UNOFFERED_GROUP,
  filterModelRows,
  modelEffortOptions,
  modelOptionValue,
  modelOptions,
  modelRowOf,
  modelRows,
} from './model-options.js';

export interface ModelPickerFieldProps {
  /** The stored route; absent means the deployment default. */
  value: ModelSelection | undefined;
  /** The live catalog, or null when the host could not be asked for one. */
  catalog: ModelCatalog | null | undefined;
  /** Called with the next route, or with undefined to fall back to the deployment default. */
  onChange: (selection: ModelSelection | undefined) => void;
  /** Whether the picker is busy. */
  disabled?: boolean;
  /** Re-read the catalog from the host; the reload affordance appears only when supplied. */
  refresh?: () => void;
}

/**
 * The one model picker both configuration surfaces share: a schedule names the
 * route of its sessions, a board names the route of its conversations, and both
 * mean the same thing by it. Only the route is chosen here — what a surface does
 * with it, and what it says when the catalog is missing it, stays with the caller.
 */
export function ModelPickerField({ value, catalog, onChange, disabled = false, refresh }: ModelPickerFieldProps) {
  const efforts = modelEffortOptions(catalog, value);
  const stored = value?.reasoningEffort;
  const storedEffort = stored !== undefined && stored !== '' && !efforts.some(effort => effort.id === stored) ? stored : undefined;
  function chooseEffort(effort: string): void {
    if (value === undefined) return;
    // Built field by field rather than spread over the stored one: choosing
    // "Model default" has to *remove* the effort, and spreading an empty object
    // over a value that already carries one keeps it.
    onChange({
      provider: value.provider,
      model: value.model,
      ...(effort === '' ? {} : { reasoningEffort: effort }),
    });
  }
  return <>
    <div className="kb-field">
      <span className="kb-field-label">Model</span>
      <ModelCombobox value={value} catalog={catalog} onChange={onChange} disabled={disabled} {...(refresh === undefined ? {} : { refresh })} />
    </div>
    {(efforts.length > 0 || storedEffort !== undefined) && <label className="kb-field">Reasoning effort<select className="kb-input" aria-label="Reasoning effort" disabled={disabled} value={stored ?? ''} onChange={event => chooseEffort(event.target.value)}>
      <option value="">Model default</option>
      {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
      {storedEffort !== undefined && <option value={storedEffort}>{storedEffort} (stored, no longer offered)</option>}
    </select></label>}
  </>;
}
