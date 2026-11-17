import { KanbanError } from '../../../shared/errors.js';
import { SHARED_LAYOUT_VERSION } from '../../../domain/sharing/layout.js';
import type { SharedLayoutStore } from '../ports.js';

/**
 * The layout stamp and its version negotiation. The stamp states the layout format and
 * nothing else, so this is the only place that reads or writes it.
 */
export class LayoutStampPolicy {
  /** The problem one stored stamp states, or null when this installation writes it. */
  versionProblem(version: number): { code: string; message: string } {
    return version > SHARED_LAYOUT_VERSION
      ? { code: 'SHARING_DOCUMENT_VERSION_UNSUPPORTED', message: 'This team storage was written by a newer plugin version. Update dsh-kanban to read or publish it.' }
      : { code: 'SHARING_LAYOUT_OUTDATED', message: 'This team storage holds a layout dsh-kanban no longer reads. Connect the storage again to publish the current layout.' };
  }

  /** Write the stamp when the storage has none, and refuse a version this build does not write. */
  async ensure(layout: SharedLayoutStore): Promise<void> {
    const stamp = await layout.readStamp();
    if (stamp === null) { await layout.writeStamp(SHARED_LAYOUT_VERSION, { expectedVersion: null }); return; }
    if (stamp.version === SHARED_LAYOUT_VERSION) return;
    if (stamp.version < SHARED_LAYOUT_VERSION) {
      // An older layout is replaced in place: its entries stay untouched, and the stamp
      // this installation writes is the current one.
      await layout.writeStamp(SHARED_LAYOUT_VERSION, { expectedVersion: stamp.version });
      return;
    }
    const problem = this.versionProblem(stamp.version);
    throw new KanbanError(problem.code, problem.message);
  }

  /** The layout version this installation writes. */
  get version(): number { return SHARED_LAYOUT_VERSION; }
}
