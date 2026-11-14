import { describe, expect, it } from 'vitest';
import type { KanbanSnapshot } from '../../src/shared/types.js';
import { creationModelOutcome, creationPresetOutcome, creationReceiptId } from '../../src/client/ui.js';

function snapshot(receipt: KanbanSnapshot['commandReceipt']): KanbanSnapshot {
  return { commandReceipt: receipt } as KanbanSnapshot;
}

const preset = { requested: 'standard', applied: false as const, reason: 'unavailable' as const };
const model = { requested: { provider: 'p', model: 'm' }, applied: true };

describe('creation receipt helpers', () => {
  it('reads the preset outcome only from a conversation receipt', () => {
    expect(creationPresetOutcome(snapshot({ kind: 'conversation', id: 's1', preset }))).toEqual(preset);
    expect(creationPresetOutcome(snapshot({ kind: 'task', id: 't1', preset }))).toBeUndefined();
    expect(creationPresetOutcome(snapshot(undefined))).toBeUndefined();
  });

  it('keeps the model and preset outcomes independent', () => {
    const both = snapshot({ kind: 'conversation', id: 's1', model, preset });
    expect(creationModelOutcome(both)).toEqual(model);
    expect(creationPresetOutcome(both)).toEqual(preset);
    expect(creationReceiptId(both, 'conversation')).toBe('s1');
  });
});
