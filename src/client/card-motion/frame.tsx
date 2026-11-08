import React, { Component, createRef, type ReactNode } from 'react';
import { CARD_MOTION, type CardMotionConfig } from './config.js';
import { CardAnimator, webAnimations, type CardMotionAnimator } from './animator.js';
import { exitCopyRect, intersectsViewport, planCardMotion, sameRowKeys, type CardRect, type CardSnapshot } from './layout.js';
import { prefersReducedMotion } from './preference.js';

export interface CardMotionFrameProps {
  /** The rendered card ids in DOM order; a difference is what starts motion. */
  rowKeys: readonly string[];
  /** Changes when the presented view is replaced, so a replacement settles immediately. */
  resetKey: string;
  /** Whether a board state is being rendered; a board that is not ready settles. */
  ready: boolean;
  className: string;
  label?: string;
  children: ReactNode;
  /** Isolated harnesses may replace the animator, configuration, and preference reading. */
  animator?: CardMotionAnimator;
  config?: CardMotionConfig;
  reducedMotion?: () => boolean;
}

interface RowGeometry { readonly elements: Map<string, HTMLElement>; readonly snapshot: CardSnapshot }
interface FrameSnapshot { readonly rows: RowGeometry }

/** The card's last identity-free presentation, placed inside the motion overlay. */
function exitCopy(row: HTMLElement, rect: CardRect, origin: CardRect): HTMLElement {
  const copy = row.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-task-id');
  copy.removeAttribute('data-working');
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  const placement = exitCopyRect(rect, origin);
  Object.assign(copy.style, {
    position: 'absolute', margin: '0', transform: 'none', boxSizing: 'border-box', pointerEvents: 'none',
    left: placement.left + 'px', top: placement.top + 'px', width: placement.width + 'px', height: placement.height + 'px',
  });
  return copy;
}

/** The visible part of the board inside the window; only cards that intersect it move. */
function visibleViewport(list: HTMLElement): CardRect {
  const rect = list.getBoundingClientRect();
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = typeof window === 'undefined' ? rect.right : Math.min(rect.right, window.innerWidth);
  const bottom = typeof window === 'undefined' ? rect.bottom : Math.min(rect.bottom, window.innerHeight);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function readRows(list: HTMLElement): RowGeometry {
  const elements = new Map<string, HTMLElement>();
  const rects = new Map<string, CardRect>();
  const keys: string[] = [];
  for (const element of Array.from(list.querySelectorAll<HTMLElement>('[data-task-id]'))) {
    const key = element.dataset['taskId'];
    if (key === undefined || elements.has(key)) continue;
    const rect = element.getBoundingClientRect();
    keys.push(key);
    elements.set(key, element);
    rects.set(key, { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }
  return { elements, snapshot: { keys, rects } };
}

/**
 * Animates the keyed cards rendered inside it.
 *
 * React commits, not observers, drive it: the pre-mutation geometry is read in
 * `getSnapshotBeforeUpdate`, so a card that changes columns is animated from
 * where it was, and every other card that changed position glides to its new
 * one. Rows that only changed size, a replaced view, an oversized batch, and the
 * reduced-motion preference all settle immediately.
 */
export class CardMotionFrame extends Component<CardMotionFrameProps> {
  private armed = false;
  private readonly list = createRef<HTMLDivElement>();
  private readonly overlay = createRef<HTMLDivElement>();
  private readonly animator: CardMotionAnimator;
  private readonly config: CardMotionConfig;
  private readonly reducedMotion: () => boolean;

  constructor(props: CardMotionFrameProps) {
    super(props);
    this.config = props.config ?? CARD_MOTION;
    this.animator = props.animator ?? new CardAnimator(this.config.timing, webAnimations(), this.config.stackingIndex);
    this.reducedMotion = props.reducedMotion ?? prefersReducedMotion;
  }

  override getSnapshotBeforeUpdate(previous: CardMotionFrameProps): FrameSnapshot | null {
    if (!this.shouldAnimate(previous)) return null;
    const list = this.list.current;
    if (list === null) return null;
    const rows = readRows(list);
    return rows.snapshot.keys.length === 0 ? null : { rows };
  }

  override componentDidUpdate(previous: CardMotionFrameProps, _state: unknown, snapshot: FrameSnapshot | null): void {
    const list = this.list.current;
    const overlay = this.overlay.current;
    if (list === null || overlay === null) { this.animator.cancelAll(); return; }
    if (snapshot === null) {
      if (this.settlesOnCommit(previous)) this.animator.cancelAll();
      return;
    }
    // Cancel first: a running glide holds a transform that would otherwise be
    // measured as the card's layout position.
    this.animator.cancelMovements();
    const current = readRows(list);
    const viewport = visibleViewport(list);
    const visible = viewport.width === 0 || viewport.height === 0
      ? () => true
      : (rect: CardRect) => intersectsViewport(rect, viewport);
    const plan = planCardMotion(snapshot.rows.snapshot, current.snapshot, visible);
    // Only cards entering or leaving the board count toward the cap; cards that stay
    // and shift to make room are the movement this pipeline exists for, and a normal
    // move in a long stage can shift more than the cap allows.
    const membership = plan.entered.length + plan.exited.length;
    const changes = plan.movements.length + membership;
    if (changes === 0 || membership > this.config.batchLimit) { this.animator.cancelAll(); return; }
    for (const movement of plan.movements) {
      const element = current.elements.get(movement.key);
      if (element !== undefined) this.animator.glide(element, movement);
    }
    for (const key of plan.entered) {
      const element = current.elements.get(key);
      if (element !== undefined) this.animator.fadeIn(element);
    }
    const origin = overlay.getBoundingClientRect();
    for (const key of plan.exited) {
      const row = snapshot.rows.elements.get(key);
      const rect = snapshot.rows.snapshot.rects.get(key);
      if (row === undefined || rect === undefined) continue;
      this.animator.fadeOut(exitCopy(row, rect, origin), overlay);
    }
  }

  override componentWillUnmount(): void {
    this.animator.cancelAll();
  }

  private shouldAnimate(previous: CardMotionFrameProps): boolean {
    return this.armed
      && this.animator.enabled
      && previous.ready && this.props.ready
      && previous.resetKey === this.props.resetKey
      && !this.reducedMotion()
      && !sameRowKeys(previous.rowKeys, this.props.rowKeys);
  }

  private settlesOnCommit(previous: CardMotionFrameProps): boolean {
    return !this.animator.enabled
      || !this.props.ready
      || previous.resetKey !== this.props.resetKey
      || this.reducedMotion();
  }

  private readonly arm = (): void => { this.armed = true; };

  override render(): ReactNode {
    return (
      <div ref={this.list} className={this.props.className} aria-label={this.props.label}
        onPointerDownCapture={this.arm} onKeyDownCapture={this.arm}>
        {this.props.children}
        <div ref={this.overlay} className="kb-motion-overlay" aria-hidden="true" />
      </div>
    );
  }
}
