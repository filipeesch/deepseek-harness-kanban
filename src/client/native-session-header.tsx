import React, { Component, useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import { NativeSessionActions, nativeStatusActions, type NativeActionOverride } from './native-session-actions.js';
import { renderableNativeEntries, selectNativeSessionHeaderEntry } from './native-slot-descriptors.js';
import {
  NativeSlotHost, useLocaleRevision, useSlotEntries, type NativeFaceOverride, type NativeLocaleSource, type NativeSlotSource, type NativeSnapshotSource,
} from './native-slot-host.js';
import { NativeModeSeat, useModeSeatController } from './mode-seat.js';
import type { ModePort } from './mode-port.js';
import type { ConversationNavigation, DrawerSubagentAddress } from './conversation-navigation.js';

export interface NativeSessionHeaderProps {
  slots: NativeSlotSource;
  locale: NativeLocaleSource;
  standard: Record<string, unknown>;
  navigation: ConversationNavigation;
  modePort: ModePort | null;
  developerTools?: NativeSnapshotSource;
  renderFactorySlot?: unknown;
  /** Plugin-owned action rendered at the end of the native header row. */
  trailing?: ReactNode;
}

type SelectorHook = (selector: (value: unknown) => unknown) => unknown;

function readSession(standard: Record<string, unknown>): { blank?: boolean } | undefined {
  const useSession = standard.useSession as SelectorHook | undefined;
  return useSession === undefined ? undefined : useSession(value => value) as { blank?: boolean } | undefined;
}

function readOrigin(standard: Record<string, unknown>, sessionId: string): string | undefined {
  const useSessions = standard.useSessions as SelectorHook | undefined;
  return useSessions === undefined
    ? undefined
    : useSessions(value => (value as { byId?: Record<string, { origin?: string }> }).byId?.[sessionId]?.origin) as string | undefined;
}

function readPreset(standard: Record<string, unknown>, sessionId: string): string | undefined {
  const useSessions = standard.useSessions as SelectorHook | undefined;
  return useSessions === undefined
    ? undefined
    : useSessions(value => (value as { byId?: Record<string, { projectionValues?: { agentPreset?: string } }> }).byId?.[sessionId]?.projectionValues?.agentPreset) as string | undefined;
}

function NativeSessionFallback({ slots, locale, standard, navigation }: Pick<NativeSessionHeaderProps, 'slots' | 'locale' | 'standard' | 'navigation'>) {
  const entries = nativeStatusActions(useSlotEntries(slots, 'conversation.session.header.actions'));
  const overrideFace = useCallback<NativeActionOverride>((entry, face) => entry.options.id === 'subagent-catalog' ? redirectSubagent(face, navigation) : face, [navigation]);
  const translate = useCallback((namespace: string) => locale.bind(namespace), [locale]);
  return <div className="kb-conversation-status" role="group" aria-label="Conversation status">
    <NativeSessionActions
      entries={entries}
      translate={translate}
      standard={standard}
      overrideFace={overrideFace}
    />
  </div>;
}

class HeaderBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

class ModeSeatBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function SessionHeaderActions({
  slots, locale, standard, navigation, modePort, developerTools, renderFactorySlot,
}: Omit<NativeSessionHeaderProps, 'navigation'> & { navigation: ConversationNavigation }) {
  const sessionId = typeof standard.sessionId === 'string' ? standard.sessionId : '';
  const session = readSession(standard);
  const origin = readOrigin(standard, sessionId);
  const preset = readPreset(standard, sessionId);
  const seatEntries = useSlotEntries(slots, 'conversation.hero.agentPreset');
  const seatIdentity = String(seatEntries[0]?.component);
  const seatAvailable = renderableNativeEntries(seatEntries, 'single').length > 0;
  const enabled = session?.blank === true && origin !== 'subagent' && seatAvailable;
  const currentPreset = useCallback(() => preset, [preset]);
  const { controller, state } = useModeSeatController(modePort, sessionId, currentPreset, enabled);
  const [seatFailed, setSeatFailed] = useState(false);
  const seatIdentityRef = useRef(seatIdentity);
  useEffect(() => {
    if (seatIdentityRef.current === seatIdentity) return;
    seatIdentityRef.current = seatIdentity;
    setSeatFailed(false);
  }, [seatIdentity]);
  const hideLabel = enabled && state.options.length > 0 && !seatFailed;
  const exclude = useCallback((entry: StoredEntry) => hideLabel && entry.options.id === 'agent-preset', [hideLabel]);
  const override = useCallback<NativeFaceOverride>((face, context) => {
    if (context.slot !== 'conversation.session.header.actions') return face;
    if (context.entry.options.id !== 'subagent-catalog') return face;
    return redirectSubagent(face, navigation);
  }, [navigation]);
  return <NativeSlotHost
    slot="conversation.session.header.actions"
    kind="list"
    source={slots}
    locale={locale}
    standard={standard}
    exclude={exclude}
    before={enabled ? <ModeSeatBoundary onError={() => setSeatFailed(true)}><NativeModeSeat
      sessionId={sessionId}
      source={slots}
      locale={locale}
      standard={standard}
      controller={controller}
      enabled={enabled}
      {...(developerTools === undefined ? {} : { developerTools })}
    /></ModeSeatBoundary> : null}
    {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })}
    override={override}
  />;
}

function redirectSubagent(face: Record<string, unknown>, navigation: ConversationNavigation): Record<string, unknown> {
  const original = face.openChild as ((address: unknown) => void) | undefined;
  return {
    ...face,
    // Owned descendants stay in the drawer. A foreign target is not a peek and
    // keeps the native DSH navigation behavior.
    openChild: (address: unknown) => {
      if (!navigation.openSubagent(address as DrawerSubagentAddress)) original?.(address);
    },
  };
}

/**
 * Host the native session header above the native transcript. The child slots
 * are hosted manually because the slot renderer's ownership rules belong to
 * the native conversation root, which is private.
 */
export function NativeSessionHeader({ slots, locale, standard, navigation, modePort, developerTools, renderFactorySlot, trailing }: NativeSessionHeaderProps) {
  useLocaleRevision(locale);
  const headerEntry = selectNativeSessionHeaderEntry(useSlotEntries(slots, 'conversation.session.header'));
  const fallback = <NativeSessionFallback slots={slots} locale={locale} standard={standard} navigation={navigation} />;
  const redirect = useCallback<NativeFaceOverride>((face, context) => {
    if (context.slot === 'conversation.session.header.lineage') return redirectSubagent(face, navigation);
    return face;
  }, [navigation]);
  if (headerEntry === undefined) return <div className="kb-session-header-row"><div className="kb-session-header-main">{fallback}</div>{trailing}</div>;
  const Header = headerEntry.component as ComponentType<Record<string, unknown>>;
  const renderSlot = (key: string, owner?: object, options?: { fallback?: ReactNode }): ReactNode => {
    if (key === 'conversation.session.header.actions') {
      return <SessionHeaderActions
        slots={slots}
        locale={locale}
        standard={standard}
        navigation={navigation}
        modePort={modePort}
        {...(developerTools === undefined ? {} : { developerTools })}
        {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })}
      />;
    }
    const kind = key === 'conversation.session.header.utilities'
      ? 'list'
      : key === 'conversation.session.header.lineage' || key === 'conversation.session.header.corner'
        ? 'single'
        : 'list';
    return <NativeSlotHost
      slot={key}
      kind={kind}
      source={slots}
      locale={locale}
      standard={standard}
      {...(owner === undefined ? {} : { owner })}
      {...(options?.fallback === undefined ? {} : { fallback: options.fallback })}
      override={redirect}
      {...(renderFactorySlot === undefined ? {} : { renderFactorySlot })}
    />;
  };

  const headerProps: Record<string, unknown> = {
    ...standard,
    hideChrome: false,
    open: (sessionId: string) => navigation.openSession(sessionId),
    selectView: () => {},
    useConversationViews: (selector?: (value: readonly never[]) => unknown) => selector === undefined ? [] : selector([]),
    useStore: (selector?: (value: { view: string }) => unknown) => selector === undefined ? { view: 'chat' } : selector({ view: 'chat' }),
    renderSlot,
    t: locale.bind('conversation'),
    ...(renderFactorySlot === undefined ? {} : { renderFactorySlot }),
  };

  return <div className="kb-session-header-row"><div className="kb-session-header-main"><HeaderBoundary key={String(headerEntry.options.key ?? headerEntry.options.id ?? headerEntry.component)} fallback={fallback}>
    <div className="kb-native-session-header" data-native-session-header="">
      <Header {...headerProps} />
    </div>
  </HeaderBoundary></div>{trailing}</div>;
}
