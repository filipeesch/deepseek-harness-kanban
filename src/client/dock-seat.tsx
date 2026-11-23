import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { HEADER_FALLBACK, seatPlan, type StripMetrics } from './seat-budget.js';

/** Marks a docked strip's box, so the seat can tell the strips apart from the composer. */
export const DOCK_STRIP_ATTRIBUTE = 'data-kb-dock-strip';
/** Marks a strip whose fixed controls cannot all fit; the strip scrolls as a whole instead. */
export const DOCK_TIGHT_ATTRIBUTE = 'data-kb-dock-tight';
/** Marks a strip presented above the conversation because the seat cannot hold its controls. */
export const DOCK_CRAMPED_ATTRIBUTE = 'data-kb-dock-cramped';
/** Identifies one docked strip's box, so its portaled box can be found from the seat. */
export const DOCK_SEAT_ATTRIBUTE = 'data-kb-dock-seat';
/** Marks one portaled box; the value is the seat identity it belongs to. */
export const DOCK_PANEL_ATTRIBUTE = 'data-kb-dock-panel';
/** Marks a compact launcher box, shown as one panel at a time in a shallow conversation. */
export const DOCK_LAUNCHER_ATTRIBUTE = 'data-kb-dock-launcher';
/** Whether this launcher box is the open one. */
export const DOCK_ACTIVE_ATTRIBUTE = 'data-kb-dock-active';
/** The host seat's gap, used when the computed gap is unreadable. */
const GAP_FALLBACK = 6;
/** The padding the cramped panel keeps from the conversation it floats over. */
const PANEL_INSET = 8;

let nextSeat = 0;

/** The strip the person is working on, per conversation layer, so panels never overlap. */
const groups = new WeakMap<Element, string>();
const activeByGroup = new Map<string, string>();
const groupListeners = new Set<() => void>();
let nextGroup = 0;

function groupOf(layer: Element): string {
  let key = groups.get(layer);
  if (key === undefined) { key = 'kb-dock-group-' + (++nextGroup); groups.set(layer, key); }
  return key;
}

function activeSeatOf(group: string): string | undefined {
  return activeByGroup.get(group);
}

function noticeActive(group: string, seat: string): void {
  if (activeByGroup.get(group) === seat) return;
  activeByGroup.set(group, seat);
  for (const listener of groupListeners) listener();
}

/** How the seat can present one strip. */
export interface SeatBudget {
  /** `dock` bounds the strip inside the composer seat; `cramped` presents it above the conversation. */
  readonly mode: 'dock' | 'cramped';
  /** Height the strip may use when it lives in the seat. */
  readonly budget: number;
  /** Whether the fixed controls cannot all fit and the strip scrolls as a whole. */
  readonly tight: boolean;
  /** Placement of the cramped panel, in viewport coordinates. */
  readonly panel?: Readonly<{ left: number; top: number; width: number; height: number }>;
  /** Whether the strips are shown as compact launchers with one panel open at a time. */
  readonly launcher?: boolean;
  /** Whether this strip is the open one of a launcher group. */
  readonly active?: boolean;
  /** The conversation layer the strip belongs to, used to coordinate the launcher group. */
  readonly group?: string;
}

/** The scrollport a strip lives in: the conversation's scrolling body. */
export function dockScrollport(element: HTMLElement | null): HTMLElement | undefined {
  for (let node = element?.parentElement ?? null; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return undefined;
}

/** Whether one element is, or carries, a docked strip of this plugin. */
function isStripChild(element: Element): boolean {
  return element.hasAttribute(DOCK_STRIP_ATTRIBUTE) || element.querySelector('[' + DOCK_STRIP_ATTRIBUTE + ']') !== null;
}

/** Whether an element occupies height in the seat's flow, so it must be reserved. */
function reservesSpace(element: Element): boolean {
  if (getComputedStyle(element).display === 'none') return false;
  const position = getComputedStyle(element).position;
  if (position === 'absolute' || position === 'fixed') return false;
  return element.getBoundingClientRect().height > 0;
}

function displays(element: Element): boolean {
  return getComputedStyle(element).display !== 'none';
}

function heightOf(element: Element): number {
  return element.getBoundingClientRect().height;
}

function rowGapOf(element: Element): number {
  return Number.parseFloat(getComputedStyle(element).rowGap) || GAP_FALLBACK;
}

/** The height of one strip's header bar: the part that stays as its entry point. */
function headerHeightOf(strip: HTMLElement | undefined): number {
  const header = strip?.querySelector<HTMLElement>('.kq-header');
  return header === null || header === undefined ? HEADER_FALLBACK : heightOf(header);
}

/**
 * The measured geometry of one strip, as the height policy takes it.
 *
 * A strip whose body is hidden costs only its header. An expanded strip reports the
 * height its body content needs, read from the unclipped scroll body, so a strip that is
 * currently squeezed still reports the height it would like.
 */
function stripMetricsOf(strip: HTMLElement | undefined): StripMetrics {
  const header = Math.ceil(headerHeightOf(strip));
  if (strip === null || strip === undefined) return { header, fixed: header, content: 0, expanded: false };
  // The budget bounds the strip's border box, so its own border and the panel's rule
  // belong to what the strip needs; leaving them out would clip the body by a pixel or
  // two and keep a scrollbar on content that actually fits.
  const borders = Math.max(0, strip.offsetHeight - strip.clientHeight);
  const panel = strip.querySelector<HTMLElement>('.kq-panel');
  if (panel === null) return { header, fixed: header + borders, content: 0, expanded: false };
  const footer = strip.querySelector<HTMLElement>('.kq-footer');
  const panelRule = Number.parseFloat(getComputedStyle(panel).borderTopWidth) || 0;
  const fixed = Math.ceil(header + (footer === null ? 0 : heightOf(footer)) + borders + panelRule);
  const content = Math.ceil(strip.querySelector<HTMLElement>('.kq-scroll')?.scrollHeight ?? 0);
  return { header, fixed, content, expanded: true };
}

/**
 * The layer that holds both the strips and the composer.
 *
 * The pinned host nests the dock entries and the composer card inside one stack, which
 * itself sits inside the sticky seat. The layer is the lowest ancestor of a strip that
 * also contains the composer's input, so the composer is always reserved; a host without
 * a composer marker inside the scrollport falls back to the deepest ancestor whose
 * siblings include a box that takes room.
 */
function stripLayer(element: HTMLElement | null, port: HTMLElement | undefined): HTMLElement | undefined {
  if (element === null || port === undefined) return undefined;
  const composer = port.querySelector<HTMLElement>('[data-composer-input], [contenteditable="true"]');
  if (composer !== null) {
    for (let node: HTMLElement | null = element; node !== null && node !== port; node = node.parentElement) {
      if (node.contains(composer)) return node;
    }
  }
  for (let node: HTMLElement | null = element; node !== null && node !== port; node = node.parentElement) {
    const parent = node.parentElement;
    if (parent === null) break;
    const others = Array.from(parent.children).some(child => child !== node && !isStripChild(child) && reservesSpace(child));
    if (others) return parent;
  }
  let node: HTMLElement = element;
  while (node.parentElement !== null && node.parentElement !== port) node = node.parentElement;
  return node.parentElement === port ? node : undefined;
}

/** The strip a box renders, either in the seat or inside its portaled box. */
function stripOf(box: HTMLElement): HTMLElement | undefined {
  const inPlace = box.querySelector<HTMLElement>('.kq-strip');
  if (inPlace !== null) return inPlace;
  const seat = box.getAttribute(DOCK_SEAT_ATTRIBUTE);
  if (seat === null) return undefined;
  return document.querySelector<HTMLElement>('[' + DOCK_PANEL_ATTRIBUTE + '="' + seat + '"] .kq-strip') ?? undefined;
}

/** The visible part of the conversation, in viewport coordinates. */
function visibleConversation(port: HTMLElement): { left: number; top: number; right: number; bottom: number } {
  const box = port.getBoundingClientRect();
  return {
    left: Math.max(box.left, 0),
    top: Math.max(box.top, 0),
    right: Math.min(box.right, window.innerWidth),
    bottom: Math.min(box.bottom, window.innerHeight),
  };
}

/**
 * The height one docked strip may use.
 *
 * The composer seat is sticky at the bottom of the conversation's scrollport, so the
 * strips, the composer, and any other seat entry must share the scrollport's height
 * instead of each taking a share of the browser viewport. Every non-strip child of the
 * layer that holds the strips — the composer card above all — and every element the seat
 * adds above that layer is reserved first. Each strip then grows with its own content up
 * to what the seat can spare, never past the conversation's chat scrollport, and the
 * spare height is shared by need (see `seat-budget`). When the fixed controls cannot
 * share the seat with the composer at all, the strip is presented above the visible
 * conversation in a portaled panel, so it stays answerable.
 * @param anchor - the strip's box in the seat.
 * @returns how that strip may be presented, or undefined when the host gives no scrollport.
 */
export function seatStripBudget(anchor: HTMLElement | null): SeatBudget | undefined {
  const port = dockScrollport(anchor);
  const layer = stripLayer(anchor, port);
  if (anchor === null || port === undefined || layer === undefined || port.clientHeight <= 0) return undefined;
  const boxes = Array.from(layer.children).filter(child => child.hasAttribute(DOCK_STRIP_ATTRIBUTE) && displays(child)) as HTMLElement[];
  const index = boxes.indexOf(anchor);
  if (index < 0) return undefined;
  const strips = boxes.map(stripOf);

  let reserved = 0;
  let gaps = 0;
  for (const child of Array.from(layer.children)) {
    if (isStripChild(child) || !reservesSpace(child)) continue;
    reserved += heightOf(child);
  }
  const layerChildren = Array.from(layer.children).filter(displays);
  gaps += rowGapOf(layer) * Math.max(0, layerChildren.length - 1);
  let path: HTMLElement = layer;
  while (path.parentElement !== null && path.parentElement !== port) {
    const parent = path.parentElement;
    for (const child of Array.from(parent.children)) {
      if (child === path || !reservesSpace(child)) continue;
      reserved += heightOf(child);
      gaps += rowGapOf(parent);
    }
    path = parent;
  }

  const count = boxes.length;
  const view = visibleConversation(port);
  const panelGap = rowGapOf(layer);
  const top = Math.round(view.top + PANEL_INSET);
  const crampedSpace = Math.max(0, Math.round(view.bottom - top - PANEL_INSET));
  const plan = seatPlan(strips.map(stripMetricsOf), { dockSpace: port.clientHeight - reserved - gaps, crampedSpace, gap: panelGap });
  if (plan.mode === 'dock') {
    // The strips live in the seat: each keeps its fixed controls, and its body scrolls
    // only when the content is taller than the height the seat can spare.
    return { mode: 'dock', budget: plan.budgets[index]!, tight: plan.tight };
  }

  // Not even the headers fit beside the composer: present each strip above the visible
  // part of the conversation, in a portaled panel that scrolls as a whole.
  const width = Math.min(688, Math.max(160, Math.round(view.right - view.left - 32)));
  const group = groupOf(layer);
  const seatIds = boxes.map(box => box.getAttribute(DOCK_SEAT_ATTRIBUTE) ?? '');
  if (!plan.launcher) {
    // Every strip gets a disjoint slot, so expanded panels never cover each other.
    const panelHeight = plan.panelHeight;
    const slot = panelHeight + panelGap;
    return {
      mode: 'cramped',
      budget: panelHeight,
      tight: true,
      group,
      panel: { left: Math.round(view.left + 16), top: top + index * slot, width, height: panelHeight },
    };
  }
  // Too shallow for two usable panels: compact launchers, one open panel at a time.
  const stored = activeSeatOf(group);
  // A reopened conversation may reuse the layer: a stored strip that is gone cannot open
  // anything, so the first visible strip opens instead.
  const active = stored !== undefined && seatIds.includes(stored) ? stored : seatIds[0] ?? '';
  if (stored !== active) activeByGroup.set(group, active);
  const isActive = seatIds[index] === active;
  const pitch = HEADER_FALLBACK + panelGap;
  const openHeight = Math.max(0, crampedSpace - count * pitch);
  return {
    mode: 'cramped',
    budget: openHeight,
    tight: true,
    launcher: true,
    active: isActive,
    group,
    panel: isActive
      ? { left: Math.round(view.left + 16), top: top + count * pitch, width, height: openHeight }
      : { left: Math.round(view.left + 16), top: top + index * pitch, width, height: HEADER_FALLBACK },
  };
}

/** Whether two measurements mean the same layout, so a re-measure need not re-render. */
function sameSeat(left: SeatBudget | undefined, right: SeatBudget | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.mode !== right.mode || left.budget !== right.budget || left.tight !== right.tight) return false;
  if (left.launcher !== right.launcher || left.active !== right.active || left.group !== right.group) return false;
  if (left.panel === undefined || right.panel === undefined) return left.panel === right.panel;
  return left.panel.left === right.panel.left && left.panel.top === right.panel.top
    && left.panel.width === right.panel.width && left.panel.height === right.panel.height;
}

/**
 * One docked strip's box inside the composer seat.
 *
 * The strip's content lives in one box created once and then moved between the seat and
 * the document body, so a change of presentation never remounts the form and never
 * discards an answer in progress. In the seat the box publishes the height the seat can
 * spare as `--kb-dock-budget`, so the strip is bounded by the conversation it actually
 * lives in rather than by the browser window. When the seat cannot hold the strip at all,
 * the box is appended to the document body: the host's dock contract requires fixed
 * overlays there, and the host's sticky seat would otherwise be their containing block.
 * A `visible` box that is false keeps its children mounted without taking a gap or a
 * share of the seat. Only the strip's own box, the layer that holds it, and the
 * scrollport are observed, so unrelated page activity costs no layout work.
 */
export function DockStrip({ children, visible = true }: { readonly children: ReactNode; readonly visible?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seat, setSeat] = useState<SeatBudget>();
  const seatId = useMemo(() => 'kb-dock-' + (++nextSeat), []);
  const box = useMemo(() => (typeof document === 'undefined' ? null : document.createElement('div')), []);
  const activeGroup = useRef<string | null>(null);
  const seatRef = useRef<SeatBudget>();
  seatRef.current = seat;
  const wasActive = useRef<boolean | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || box === null) return undefined;
    let frame = 0;
    const schedule = (callback: () => void): number => typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(callback)
      : window.setTimeout(callback, 0) as unknown as number;
    const cancel = (handle: number): void => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
      else window.clearTimeout(handle);
    };
    const measure = (): void => {
      cancel(frame);
      frame = schedule(() => {
        const next = seatStripBudget(element);
        activeGroup.current = next?.group ?? null;
        setSeat(previous => sameSeat(previous, next) ? previous : next);
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    const watched = new Set<Element>();
    const watch = (node: Element | null | undefined): void => {
      if (node === null || node === undefined || watched.has(node)) return;
      watched.add(node);
      observer?.observe(node);
    };
    const refresh = (): void => {
      watch(element);
      watch(element.parentElement);
      watch(dockScrollport(element));
      watch(box);
      for (const node of box.querySelectorAll('.kq-header, .kq-footer, .kq-collapsed-status, .kq-error')) watch(node);
      measure();
    };
    // Only the strip's own box is watched for mounted or removed controls; the rest of
    // the document is none of its business.
    const mutations = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(refresh);
    mutations?.observe(box, { childList: true, subtree: true });
    const seatObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(measure);
    if (element.parentElement !== null) seatObserver?.observe(element.parentElement, { childList: true });
    // The first measurement runs synchronously, before paint.
    setSeat(seatStripBudget(element));
    refresh();
    window.addEventListener('resize', measure);
    // A page that scrolls changes the visible part of the conversation; captured scroller
    // events do not.
    window.addEventListener('scroll', measure, { passive: true });
    // A launcher group re-measures whenever the person opens another of its strips.
    const onGroupChange = (): void => measure();
    groupListeners.add(onGroupChange);
    return () => {
      groupListeners.delete(onGroupChange);
      cancel(frame);
      observer?.disconnect();
      mutations?.disconnect();
      seatObserver?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [visible, box]);
  useLayoutEffect(() => {
    if (box === null) return undefined;
  // In launcher mode the strip's own collapse toggle must agree with what is on screen:
  // an inactive launcher is collapsed, and only the open one reports itself expanded.
  const applyLauncherState = (): void => {
    const current = seatRef.current;
    const header = box.querySelector<HTMLElement>('.kq-header');
    const panel = box.querySelector('.kq-panel');
    if (current?.launcher !== true) {
      // Leaving the launcher presentation restores the form's own disclosure state:
      // whether its body is on screen right now.
      if (header !== null && header.hasAttribute('data-kb-dock-override')) {
        const expanded = box.querySelector('.kq-panel') !== null;
        header.removeAttribute('data-kb-dock-override');
        header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      panel?.removeAttribute('hidden');
      wasActive.current = undefined;
      return;
    }
    const open = current.active === true;
    // Selecting a launcher opens it, even when the person had collapsed it before.
    if (open && wasActive.current === false && header !== null && panel === null) header.click();
    wasActive.current = open;
    // An inactive launcher is collapsed; the open one follows its own body, which is absent
    // while the person has collapsed it.
    const expanded = open && box.querySelector('.kq-panel') !== null;
    if (header !== null) {
      header.setAttribute('data-kb-dock-override', '');
      if (header.getAttribute('aria-expanded') !== (expanded ? 'true' : 'false')) header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    if (panel !== null) {
      if (open) panel.removeAttribute('hidden');
      else if (!panel.hasAttribute('hidden')) panel.setAttribute('hidden', '');
    }
  };
  applyLauncherState();
  const launcherObserver = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(() => applyLauncherState());
  launcherObserver?.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'hidden'] });
    return () => launcherObserver?.disconnect();
  }, [box, seat]);

  // A strip that is opened becomes the open one of its launcher group, and unmounting takes
  // the box with it: React removes the portal children, not the element we appended.
  useEffect(() => {
    if (box === null) return undefined;
    const activate = (): void => {
      const group = activeGroup.current;
      if (group !== null) noticeActive(group, seatId);
    };
    // A compact launcher only opens its strip: the disclosure click must not also toggle
    // the form's own collapse state, or the panel would close as it becomes the open one.
    // Only the disclosure button is intercepted; every other control in its row — the
    // countdown cancel above all — keeps working on an inactive launcher.
    const intercept = (event: Event): void => {
      const current = seatRef.current;
      if (current?.launcher !== true || current.active === true) return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest('.kq-header') === null) return;
      event.preventDefault();
      event.stopPropagation();
      activate();
    };
    box.addEventListener('click', intercept, true);
    return () => {
      box.removeEventListener('click', intercept, true);
      // A closed conversation must not leave a stale open launcher behind.
      const group = activeGroup.current;
      if (group !== null && activeByGroup.get(group) === seatId) activeByGroup.delete(group);
      box.remove();
    };
  }, [box, seatId]);
  // Move the box between the seat and the document without touching the form inside it.
  useLayoutEffect(() => {
    if (box === null) return;
    const element = ref.current;
    // Moving a box through the DOM drops focus; put it back where it was.
    const focused = document.activeElement;
    const restore = focused !== null && focused !== box && box.contains(focused) ? focused as HTMLElement : null;
    const cramped = !visible ? false : seat?.mode === 'cramped' && seat.panel !== undefined;
    if (cramped && seat?.panel !== undefined) {
      box.setAttribute(DOCK_PANEL_ATTRIBUTE, seatId);
      if (seat.launcher === true) {
        box.setAttribute(DOCK_LAUNCHER_ATTRIBUTE, '');
        box.setAttribute(DOCK_ACTIVE_ATTRIBUTE, seat.active === true ? 'true' : 'false');
      } else {
        box.removeAttribute(DOCK_LAUNCHER_ATTRIBUTE);
        box.removeAttribute(DOCK_ACTIVE_ATTRIBUTE);
      }
      box.style.cssText = 'position:fixed;display:flex;flex-direction:column;z-index:30;'
        + 'left:' + seat.panel.left + 'px;top:' + seat.panel.top + 'px;'
        + 'width:' + seat.panel.width + 'px;max-height:' + seat.panel.height + 'px;'
        + '--kb-dock-panel-height:' + seat.panel.height + 'px';
      if (box.parentElement !== document.body) document.body.appendChild(box);
    }
    else {
      box.removeAttribute(DOCK_PANEL_ATTRIBUTE);
      box.removeAttribute(DOCK_LAUNCHER_ATTRIBUTE);
      box.removeAttribute(DOCK_ACTIVE_ATTRIBUTE);
      if (visible) {
        box.style.cssText = 'display:flex;flex-direction:column;flex:none;min-height:0;width:100%';
        if (element !== null && box.parentElement !== element) element.appendChild(box);
      }
      else {
        box.style.cssText = 'display:none';
        if (element !== null && box.parentElement !== element) element.appendChild(box);
      }
    }
    if (restore !== null && document.activeElement !== restore) {
      try { restore.focus({ preventScroll: true }); }
      catch { restore.focus(); }
    }
    // A moved box needs one more look, since its scrollport and layer may have changed.
    const next = seatStripBudget(element);
    activeGroup.current = next?.group ?? activeGroup.current;
    setSeat(previous => sameSeat(previous, next) ? previous : next);
  }, [seat, visible, box, seatId]);
  const cramped = visible && seat?.mode === 'cramped' && seat.panel !== undefined;
  const attributes: Record<string, string> = { [DOCK_STRIP_ATTRIBUTE]: '', [DOCK_SEAT_ATTRIBUTE]: seatId };
  if (visible && seat?.tight === true) attributes[DOCK_TIGHT_ATTRIBUTE] = '';
  if (cramped) attributes[DOCK_CRAMPED_ATTRIBUTE] = '';
  // The anchor publishes the bound, so the box and its strip inherit it wherever they sit.
  const anchorStyle: CSSProperties = !visible
    ? { display: 'none' }
    : cramped
      ? { display: 'contents' }
      : { flex: 'none', minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', ...(seat === undefined ? {} : { '--kb-dock-budget': seat.budget + 'px' } as CSSProperties) };
  return <>
    <div ref={ref} {...attributes} style={anchorStyle} />
    {box === null ? null : createPortal(children, box)}
  </>;
}