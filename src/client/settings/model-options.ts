import type { ModelCatalog, ModelEffort, ModelSelection } from '../../shared/types.js';
import { modelKey } from '../../domain/model-preference.js';

/** The option value that means "no model of our own; start on the deployment default". */
export const HOST_DEFAULT_MODEL = 'default';

/** The group heading a stored route gets when the host no longer offers it. */
export const UNOFFERED_GROUP = 'Not in the catalog';

/** One selectable route, ready to render and to filter by. */
export interface ModelRow {
  /** The `provider::model` encoding, or {@link HOST_DEFAULT_MODEL}. */
  readonly value: string;
  /** The primary line: the model name, or the neutral option's name. */
  readonly label: string;
  /** The secondary line: the provider, or the neutral option's explanation. */
  readonly detail: string;
  /** The heading this route is listed under; empty for the neutral option. */
  readonly group: string;
  /** The whole route as one line, which is what a closed picker shows. */
  readonly title: string;
  /** The route, or undefined for the deployment default. */
  readonly selection: ModelSelection | undefined;
}

/** The select value for one route, using the domain's own key encoding rather than a local one. */
export function modelOptionValue(selection: ModelSelection | undefined): string {
  return selection === undefined ? HOST_DEFAULT_MODEL : modelKey(selection);
}

/**
 * Every route the host offers, as three kinds of row: the deployment default, one
 * row per catalog model under its provider, and the stored route kept visible when
 * the catalog no longer lists it. One source of truth for the picker's rows, its
 * trigger text, and the legacy `{ value, label }` shape other surfaces still read.
 */
export function modelRows(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): ModelRow[] {
  const rows: ModelRow[] = [{
    value: HOST_DEFAULT_MODEL,
    label: 'Host default model',
    detail: 'Leave the choice to DSH',
    group: '',
    title: 'Host default model',
    selection: undefined,
  }];
  for (const provider of catalog?.providers ?? []) {
    for (const model of provider.models) {
      const route = { provider: provider.id, model: model.id };
      rows.push({
        value: modelKey(route),
        label: model.name,
        detail: provider.name + ' · ' + model.id,
        group: provider.name,
        title: provider.name + ' · ' + model.name,
        selection: route,
      });
    }
  }
  const current = modelOptionValue(selection);
  if (selection !== undefined && !rows.some(row => row.value === current)) {
    // "Not in the catalog" is a claim about a catalog that was read. Without one the
    // stored route is still listed, but under its bare ids and without that claim.
    rows.push(catalog === null || catalog === undefined
      ? {
        value: current,
        label: selection.model,
        detail: selection.provider,
        group: '',
        title: selection.provider + ' · ' + selection.model,
        selection,
      }
      : {
        value: current,
        label: selection.model + ' (not in the catalog)',
        detail: selection.provider,
        group: UNOFFERED_GROUP,
        title: selection.provider + ' · ' + selection.model + ' (not in the catalog)',
        selection,
      });
  }
  return rows;
}

/** The row one route is shown as, so a picker can name what is stored without recomputing it. */
export function modelRowOf(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): ModelRow {
  const rows = modelRows(catalog, selection);
  const current = modelOptionValue(selection);
  return rows.find(row => row.value === current) ?? rows[0]!;
}

/** The `{ value, label }` pairs the previous plain select offered, kept for its callers. */
export function modelOptions(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): Array<{ value: string; label: string }> {
  return modelRows(catalog, selection).map(row => ({ value: row.value, label: row.title }));
}

/** The reasoning efforts the catalog advertises for the stored route. */
export function modelEffortOptions(catalog: ModelCatalog | null | undefined, selection: ModelSelection | undefined): ModelEffort[] {
  if (selection === undefined || catalog === null || catalog === undefined) return [];
  return catalog.providers.find(provider => provider.id === selection.provider)?.models
    .find(model => model.id === selection.model)?.reasoning?.efforts ?? [];
}

/** Fold case and accents so a search for "razao" finds "Razão". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * The rows matching a typed query, in catalog order. Every whitespace-separated
 * term must appear somewhere in the row, so "deep reason" narrows by provider and
 * model at once. An empty query keeps every row.
 */
export function filterModelRows(rows: readonly ModelRow[], query: string): ModelRow[] {
  const terms = fold(query).split(/\s+/u).filter(term => term !== '');
  if (terms.length === 0) return [...rows];
  return rows.filter(row => {
    const haystack = fold([row.label, row.detail, row.title, row.group].join(' '));
    return terms.every(term => haystack.includes(term));
  });
}
