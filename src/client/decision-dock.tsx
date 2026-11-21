import React, { useEffect, useState } from 'react';
import type { ClientApi, KanbanSnapshot } from '../shared/types.js';
import { DecisionPanel } from './decision-panel.js';
import { DockStrip } from './dock-seat.js';
import type { DecisionWindowController } from './decision-window.js';
import { decisionGate } from './decision-view.js';
import { normalizeSnapshot } from './snapshot-normalize.js';
import { taskForSession } from './task-lookup.js';

/**
 * The decision gate, docked above one conversation's composer.
 *
 * The host's input-dock strip is the surface that waits for the person, so this
 * entry resolves the conversation's task and presents the gate it owns. A Session
 * that belongs to no task, or a task outside a decision stage, presents nothing:
 * the gate is a task surface that happens to live in the composer, not a
 * conversation question.
 */
export function DecisionDock({ sessionId, api, controller }: { sessionId: string; api: ClientApi; controller: DecisionWindowController }) {
  const [snapshot, setSnapshot] = useState<KanbanSnapshot | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let delivered = false;
    let unsubscribe = () => {};
    try {
      // The subscription replays the snapshot the client already holds, so the gate
      // paints immediately in a conversation opened away from the board.
      unsubscribe = api.subscribe(next => { delivered = true; if (active) setSnapshot(normalizeSnapshot(next)); });
    } catch { /* a host that refuses the subscription presents no gate */ }
    // Only a host that did not replay needs the read: one snapshot per open, not two.
    if (!delivered) void Promise.resolve().then(() => api.snapshot()).then(next => { if (active && !delivered) setSnapshot(normalizeSnapshot(next)); }, () => undefined);
    return () => { active = false; try { unsubscribe(); } catch { /* a disposed host is already gone */ } };
  }, [api]);
  if (snapshot === undefined) return null;
  const scope = taskForSession(snapshot, sessionId);
  if (scope === undefined) return null;
  // The task's own board carries everything the gate reads; no board projection is needed.
  const columns = scope.board.workflow.columns;
  const column = decisionGate(scope.task, columns);
  if (column === undefined) return null;
  const identities = scope.board.localStageIdentities;
  return <DockStrip>
    <DecisionPanel
      task={scope.task}
      column={column}
      columns={columns}
      controller={controller}
      {...(identities === undefined ? {} : { stageIdentities: identities })}
    />
  </DockStrip>;
}
