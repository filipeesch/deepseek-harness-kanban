import type { StageInstructionDelivery } from '../shared/ports.js';
import { createPluginMessageDelivery, type PluginMessageTarget } from './plugin-message-delivery.js';
import { STAGE_INSTRUCTION_SOURCE_KIND } from './stage-message.js';

/** The resolved conversation a stage instruction would land in. */
export type StageDeliveryTarget = PluginMessageTarget;

export interface StageDeliveryDeps<T extends StageDeliveryTarget> {
  /**
   * Resolve the conversation before any dedupe read. A cold session is resumed
   * here, so the target reflects the inbox the host restored rather than the
   * live registry, which is empty for a conversation that was not attached.
   */
  resolve(sessionId: string): Promise<T>;
  /** The conversation's durable events, read only after the target resolves. */
  events(sessionId: string): Promise<readonly unknown[]>;
  /** Admit the delivery through the resolved target. */
  deliver(target: T, delivery: StageInstructionDelivery): void | Promise<void>;
}

/**
 * The one delivery rule for a stage instruction: at most once per conversation and
 * delivery identity. It composes the shared plugin-message delivery so the
 * task-message path and this path cannot drift.
 */
export function createStageDelivery<T extends StageDeliveryTarget>(deps: StageDeliveryDeps<T>): (sessionId: string, delivery: StageInstructionDelivery) => Promise<void> {
  return createPluginMessageDelivery<T, StageInstructionDelivery>({ sourceKind: STAGE_INSTRUCTION_SOURCE_KIND, ...deps });
}
