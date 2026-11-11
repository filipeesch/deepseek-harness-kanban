import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as modelPreference from '../../src/domain/model-preference.js';
import { modelIsAvailable, modelKey, parseModelKey, resolveTaskConversationModel } from '../../src/domain/model-preference.js';
import type { ModelCatalog, ModelSelection } from '../../src/shared/types.js';

function catalog(providerId = 'anthropic', modelId = 'claude-sonnet-4-5'): ModelCatalog {
  return {
    default: { provider: providerId, model: modelId },
    providers: [{
      id: providerId, name: providerId,
      models: [{ id: modelId, name: modelId, reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }],
    }],
    failures: [],
  };
}

describe('the composed catalog key', () => {
  it('round-trips a route through its key', () => {
    const selection = { provider: 'anthropic', model: 'claude-sonnet-4-5' };
    expect(modelKey(selection)).toBe('anthropic::claude-sonnet-4-5');
    expect(parseModelKey(modelKey(selection))).toEqual(selection);
  });

  it('splits at the first separator so a model id may carry one', () => {
    expect(parseModelKey('anthropic::claude::nightly')).toEqual({ provider: 'anthropic', model: 'claude::nightly' });
  });

  it('keeps unusual characters that a route name may hold', () => {
    const selection = { provider: 'my.provider/v1', model: 'modelo padrão (2026)' };
    expect(parseModelKey(modelKey(selection))).toEqual(selection);
  });

  it.each(['', 'anthropic', '::claude', 'anthropic::', '  ::claude', 'anthropic::  '])(
    'refuses a key that names no route: "%s"', key => {
      expect(parseModelKey(key)).toBeUndefined();
    },
  );
});

describe('model availability', () => {
  it('asks the catalog by provider and model together', () => {
    expect(modelIsAvailable(catalog(), { provider: 'anthropic', model: 'claude-sonnet-4-5' })).toBe(true);
    expect(modelIsAvailable(catalog(), { provider: 'openai', model: 'claude-sonnet-4-5' })).toBe(false);
    expect(modelIsAvailable(catalog(), { provider: 'anthropic', model: 'claude-haiku' })).toBe(false);
  });

  it('ignores the reasoning effort, which the adapter owns', () => {
    const selection = { provider: 'anthropic', model: 'claude-sonnet-4-5', reasoningEffort: 'ultra-thinks' };
    expect(modelIsAvailable(catalog(), selection)).toBe(true);
  });

  it('treats an empty catalog as no route, so a catalog that failed to load is not available', () => {
    const empty: ModelCatalog = { default: { provider: 'anthropic', model: 'claude' }, providers: [], failures: [{ id: 'anthropic', name: 'Anthropic', message: 'Offline.' }] };
    expect(modelIsAvailable(empty, { provider: 'anthropic', model: 'claude-sonnet-4-5' })).toBe(false);
  });

  it('answers the same for an unread catalog as for an empty one', () => {
    const selection = { provider: 'anthropic', model: 'claude-sonnet-4-5' };
    expect(modelIsAvailable(undefined, selection)).toBe(modelIsAvailable({ default: selection, providers: [], failures: [] }, selection));
    expect(modelIsAvailable(undefined, selection)).toBe(false);
  });
});

describe('the model a task conversation starts on', () => {
  it('takes the board model when the board names one', () => {
    const boardModel = { provider: 'anthropic', model: 'claude', reasoningEffort: 'high' };
    expect(resolveTaskConversationModel({ boardModel })).toEqual(boardModel);
  });

  it('names no model when the board leaves the choice to the deployment', () => {
    expect(resolveTaskConversationModel({})).toBeUndefined();
    expect(resolveTaskConversationModel({ boardModel: undefined })).toBeUndefined();
  });

  it('drops a route it could not name and an effort it could not carry', () => {
    expect(resolveTaskConversationModel({ boardModel: { provider: ' ', model: 'claude' } })).toBeUndefined();
    expect(resolveTaskConversationModel({ boardModel: { provider: 'anthropic', model: '' } })).toBeUndefined();
    expect(resolveTaskConversationModel({ boardModel: { provider: 'anthropic', model: 'claude', reasoningEffort: '  ' } }))
      .toEqual({ provider: 'anthropic', model: 'claude' });
  });
});

/** The module is imported by the browser bundle; it must not reach for Node or a schema. */
describe('the module boundary', () => {
  it('exports the decisions the feature needs and nothing else', () => {
    // Read from the module itself: a list written by hand would keep passing while
    // the real surface grew or renamed.
    expect(Object.keys(modelPreference).sort()).toEqual([
      'modelIsAvailable', 'modelKey', 'modelSelectionKey', 'parseModelKey', 'resolveTaskConversationModel',
    ]);
  });

  it('imports nothing a browser bundle cannot carry', () => {
    const source = readFileSync(new URL('../../src/domain/model-preference.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]node:/);
    expect(source).not.toMatch(/from ['"]zod/);
  });
});
