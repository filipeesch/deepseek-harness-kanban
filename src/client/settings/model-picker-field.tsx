import React from 'react';
import type { ModelCatalog, ModelEffort, ModelSelection } from '../../shared/types.js';
import { modelKey, parseModelKey } from '../../domain/model-preference.js';

/** The option value that means "no model of our own; start on the deployment default". */
export const HOST_DEFAULT_MODEL = 'default';

/** The select value for one route, using the domain's own key encoding rather than a local one. */
export function modelOptionValue(selection: ModelSelection | undefined): string {
  return selection === undefined ? HOST_DEFAULT_MODEL : modelKey(selection);
}

/** Every route the host offers, with the stored route appended when the catalog no longer lists it. */
export function modelOptions(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [
    { value: HOST_DEFAULT_MODEL, label: 'Host default model' },
    ...(catalog?.providers.flatMap(provider => provider.models.map(model => ({
      value: modelKey({ provider: provider.id, model: model.id }),
      label: provider.name + ' · ' + model.name,
    }))) ?? []),
  ];
  const selected = modelOptionValue(selection);
  if (selection !== undefined && !options.some(option => option.value === selected)) {
    options.push({ value: selected, label: selection.provider + ' · ' + selection.model + ' (not in the catalog)' });
  }
  return options;
}

/** The reasoning efforts the catalog advertises for the stored route. */
export function modelEffortOptions(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): ModelEffort[] {
  if (selection === undefined || catalog === null || catalog === undefined) return [];
  return catalog.providers.find(provider => provider.id === selection.provider)?.models
    .find(model => model.id === selection.model)?.reasoning?.efforts ?? [];
}

export interface ModelPickerFieldProps {
  /** The stored route; absent means the deployment default. */
  value: ModelSelection | undefined;
  /** The live catalog, or null when the host could not be asked for one. */
  catalog: ModelCatalog | null | undefined;
  /** Called with the next route, or with undefined to fall back to the deployment default. */
  onChange: (selection: ModelSelection | undefined) => void;
  /** Whether the picker is busy; the catalog select is also closed while the catalog is unreadable. */
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
  function choose(key: string): void {
    const next = key === HOST_DEFAULT_MODEL ? undefined : parseModelKey(key);
    // Re-choosing the stored route keeps its effort; any other route starts without one.
    onChange(next !== undefined && modelKey(next) === modelOptionValue(value) ? value : next);
  }
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
    <label className="kb-field">Model<span className="kb-input-row">
      <select className="kb-input" aria-label="Model" disabled={disabled || catalog === null} value={modelOptionValue(value)} onChange={event => choose(event.target.value)}>
        {modelOptions(catalog, value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {refresh !== undefined && <button type="button" className="kb-button" disabled={disabled} onClick={refresh}>Reload models</button>}
    </span></label>
    {(efforts.length > 0 || storedEffort !== undefined) && <label className="kb-field">Reasoning effort<select className="kb-input" aria-label="Reasoning effort" disabled={disabled} value={stored ?? ''} onChange={event => chooseEffort(event.target.value)}>
      <option value="">Model default</option>
      {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
      {storedEffort !== undefined && <option value={storedEffort}>{storedEffort} (stored, no longer offered)</option>}
    </select></label>}
  </>;
}
