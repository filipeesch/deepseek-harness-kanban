import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type ComponentType } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { ModeSeatController, type ModeSeatError, type ModeSeatState } from './mode-seat-controller.js';
import type { ModePort } from './mode-port.js';
import { nativeSnapshotSelectorHook, useSlotEntries, type NativeLocaleSource, type NativeSlotSource, type NativeSnapshotSource } from './native-slot-host.js';
import { renderableNativeEntries } from './native-slot-descriptors.js';

const EMPTY_STATE: ModeSeatState = Object.freeze({ options: [], current: '', error: null, busy: false, introduce: false });
const EMPTY_SUBSCRIBE = () => () => {};

/** One controller per hosted seat; loading is gated by the blank/root decision. */
export function useModeSeatController(
  port: ModePort | null,
  sessionId: string,
  currentPreset: () => string | undefined,
  enabled: boolean,
): { controller: ModeSeatController | null; state: ModeSeatState } {
  const currentRef = useRef(currentPreset);
  currentRef.current = currentPreset;
  const controller = useMemo(() => port === null
    ? null
    : new ModeSeatController(port, sessionId, () => currentRef.current()), [port, sessionId]);
  useEffect(() => {
    if (enabled && controller !== null) void controller.load();
  }, [controller, enabled]);
  const state = useSyncExternalStore(
    controller?.subscribe ?? EMPTY_SUBSCRIBE,
    controller?.getSnapshot ?? (() => EMPTY_STATE),
    controller?.getSnapshot ?? (() => EMPTY_STATE),
  );
  return { controller, state };
}

function useRetainInfoGate(): (selector?: (value: unknown) => unknown) => unknown {
  return useMemo(() => (selector?: (value: unknown) => unknown) => {
    const value = { referenceCount: 1, retainedBy: { mainView: 1 } };
    return selector === undefined ? value : selector(value);
  }, []);
}

function useDeveloperToolsGate(source: NativeSnapshotSource | undefined): (selector?: (value: unknown) => unknown) => unknown {
  const fallback = useMemo<NativeSnapshotSource>(() => ({ getSnapshot: () => true, subscribe: () => () => {} }), []);
  return useMemo(() => nativeSnapshotSelectorHook(source ?? fallback), [source, fallback]);
}

export interface NativeModeSeatProps {
  sessionId: string;
  source: NativeSlotSource;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  controller: ModeSeatController | null;
  enabled: boolean;
  developerTools?: NativeSnapshotSource;
}

/**
 * Render the host's actual agent-preset seat with a plugin controller. The
 * synthetic `useSessionRetainInfo` only satisfies the native main-view render
 * gate; the plugin never adds a real mainView retention.
 */
export function NativeModeSeat({ sessionId, source, locale, standard, controller, enabled, developerTools }: NativeModeSeatProps) {
  const seatEntry = renderableNativeEntries(useSlotEntries(source, 'conversation.hero.agentPreset'), 'single')[0];
  const useRetainInfo = useRetainInfoGate();
  const useDeveloperTools = useDeveloperToolsGate(developerTools);
  const useAgentPresetSeat = useMemo(() => nativeSnapshotSelectorHook(controller ?? undefined), [controller]);
  const load = useCallback(() => controller === null ? Promise.resolve() : controller.load(), [controller]);
  const select = useCallback((id: string) => controller === null ? Promise.resolve(undefined) : controller.select(id), [controller]);
  const dismissRefusal = useCallback((error: ModeSeatError) => { controller?.dismissRefusal(error); }, [controller]);
  const introduced = useCallback(() => { controller?.introduced(); }, [controller]);
  const t = locale.bind('settings.agentPreset');
  if (!enabled || controller === null || seatEntry === undefined) return null;
  const Component = seatEntry.component as ComponentType<Record<string, unknown>>;
  return <Component
    {...standard}
    sessionId={sessionId}
    useSessionRetainInfo={useRetainInfo}
    useAgentPresetSeat={useAgentPresetSeat}
    useDeveloperTools={useDeveloperTools}
    load={load}
    select={select}
    dismissRefusal={dismissRefusal}
    introduced={introduced}
    t={t}
  />;
}
