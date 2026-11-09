import type { HubScheduleRuntime, ScheduleModelCatalog } from '../shared/types.js';

/**
 * The live schedule runtime as the app sees it. It is attached after the app is
 * constructed, because the runner needs the app's workspace coordinator.
 */
export interface ScheduleRuntimePort {
  /** Start one saved occurrence now; throws when paused, unknown, or already running. */
  runNow(hubId: string, scheduleId: string): Promise<void>;
  /** Drop the runtime of one deleted schedule. */
  scheduleDeleted(scheduleId: string): Promise<void>;
  /** Every Hub's runtime projection, keyed by Hub identity. */
  runtime(): Record<string, HubScheduleRuntime>;
  /** The model catalog offered to the schedule editor. */
  modelCatalog(refresh: boolean): Promise<ScheduleModelCatalog>;
}
