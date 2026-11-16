import { describe, expect, it, vi } from 'vitest';
import { createPresetReadOnlyPin } from '../../src/host/preset-readonly.js';

const PLANNER = { id: 'kanban-project-planner' };
const MANAGER = { id: 'kanban-project-manager' };

function harness(options: { preset?: string | null; currentMode?: string } = {}) {
  const pin = vi.fn();
  const report = vi.fn();
  const controller = createPresetReadOnlyPin({
    presetOf: () => options.preset === undefined ? 'kanban-project-planner' : options.preset,
    presets: new Set(['kanban-project-planner']),
    ...(options.currentMode === undefined ? {} : { currentMode: () => options.currentMode }),
    pin,
    report,
  });
  return { controller, pin, report };
}

describe('the read-only preset pin', () => {
  it('pins a planner session', () => {
    const { controller, pin } = harness();
    controller.track({ session: PLANNER });
    expect(pin).toHaveBeenCalledWith(PLANNER);
  });

  it('leaves a preset that may write unpinned', () => {
    const { controller, pin } = harness({ preset: 'kanban-project-manager' });
    controller.track({ session: MANAGER });
    expect(pin).not.toHaveBeenCalled();
  });

  it('leaves a session the host does not report a preset for', () => {
    const { controller, pin } = harness({ preset: null });
    controller.track({ session: PLANNER });
    expect(pin).not.toHaveBeenCalled();
  });

  it('does not record the pin twice when the session is already read-only', () => {
    const { controller, pin } = harness({ currentMode: 'read-only' });
    controller.track({ session: PLANNER });
    expect(pin).not.toHaveBeenCalled();
  });

  it('pins again when the session was widened', () => {
    const { controller, pin } = harness({ currentMode: 'workspace-write' });
    controller.track({ session: PLANNER });
    expect(pin).toHaveBeenCalledOnce();
  });

  it('reports a pin failure instead of throwing into the host', () => {
    const report = vi.fn();
    const controller = createPresetReadOnlyPin({
      presetOf: () => 'kanban-project-planner',
      presets: new Set(['kanban-project-planner']),
      pin: () => { throw new Error('pin failed'); },
      report,
    });
    expect(() => controller.track({ session: PLANNER })).not.toThrow();
    expect(report).toHaveBeenCalledOnce();
  });
});
