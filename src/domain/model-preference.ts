import type { ModelCatalog, ModelSelection } from '../shared/types.js';

/**
 * The one place that decides which model a conversation starts on and whether a
 * route can be offered. The host applies the decision and the client presents it;
 * both import this module so the two sides cannot drift. It reads no Node and no
 * schema, so a browser bundle carries it unchanged.
 */

/** The separator between a provider and a model in one composed catalog key. */
const KEY_SEPARATOR = '::';

/** Compose the catalog key that names one exact route. */
export function modelKey(selection: ModelSelection): string {
  return selection.provider + KEY_SEPARATOR + selection.model;
}

/**
 * The identity of a whole selection — route *and* effort — for the comparisons a
 * configuration form has to make: changing only the reasoning effort is a real
 * change, and a change saved elsewhere must reach the form again. The catalog
 * keeps naming routes with `modelKey`, which deliberately ignores the effort.
 */
export function modelSelectionKey(selection: ModelSelection | undefined): string {
  if (selection === undefined) return '';
  const effort = selection.reasoningEffort === undefined || !selection.reasoningEffort.trim() ? '' : selection.reasoningEffort;
  return modelKey(selection) + KEY_SEPARATOR + effort;
}

/**
 * Split a composed catalog key. A provider or model is never empty, so a key
 * without the separator or with an empty side is not a key at all.
 */
export function parseModelKey(key: string): ModelSelection | undefined {
  const at = key.indexOf(KEY_SEPARATOR);
  if (at <= 0 || at + KEY_SEPARATOR.length >= key.length) return undefined;
  const provider = key.slice(0, at);
  const model = key.slice(at + KEY_SEPARATOR.length);
  return provider.trim().length > 0 && model.trim().length > 0 ? { provider, model } : undefined;
}

/**
 * Whether one catalog offers this exact route. The reasoning effort never changes
 * membership, and no route at all — or no catalog to check it against — is not offered.
 */
export function modelIsAvailable(catalog: ModelCatalog | undefined, selection: ModelSelection | undefined): boolean {
  if (catalog === undefined || selection === undefined) return false;
  return catalog.providers.some(provider => provider.id === selection.provider
    && provider.models.some(model => model.id === selection.model));
}

/**
 * The model a new task conversation starts on, or nothing when the board leaves
 * it to the deployment default. A stored workflow is validated on write, so a
 * blank route here means data this version never wrote; it is treated as absent
 * rather than applied, and an empty effort is dropped instead of forwarded.
 */
export function resolveTaskConversationModel(input: { boardModel?: ModelSelection | undefined }): ModelSelection | undefined {
  const selection = input.boardModel;
  if (selection === undefined) return undefined;
  if (!selection.provider.trim() || !selection.model.trim()) return undefined;
  return selection.reasoningEffort === undefined || !selection.reasoningEffort.trim()
    ? { provider: selection.provider, model: selection.model }
    : selection;
}
