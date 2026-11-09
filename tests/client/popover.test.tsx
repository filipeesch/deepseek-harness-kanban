// @vitest-environment jsdom
import React, { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Popover, type PopoverHandle } from '../../src/client/popover.js';

afterEach(cleanup);

function Surface({ dismissable = true, initialFocusSelector, onOpen }: {
  dismissable?: boolean; initialFocusSelector?: string; onOpen?: () => void;
}) {
  return <Popover
    label="Test popover"
    trigger={<span>gear</span>}
    triggerClassName="kb-trigger"
    triggerLabel="Open test"
    dismissable={dismissable}
    initialFocusSelector={initialFocusSelector ?? 'button'}
    anchorClassName="kb-anchor-skin"
    popoverClassName="kb-body-skin"
    {...(onOpen === undefined ? {} : { onOpen })}
  >
    <button type="button">Inside action</button>
  </Popover>;
}

function Controlled() {
  const handle = useRef<PopoverHandle>(null);
  return <>
    <button type="button" onClick={() => handle.current?.close()}>Programmatic close</button>
    <Popover ref={handle} label="Test popover" trigger={<span>gear</span>} triggerClassName="kb-trigger" triggerLabel="Open test">
      <button type="button">Inside action</button>
    </Popover>
  </>;
}

const triggerButton = () => screen.getByRole('button', { name: 'Open test' });

/** Two popovers open at once, as the board filter and the drawer's closed-conversations menu are. */
function Pair() {
  return <div>
    <Popover label="First popover" trigger={<span>one</span>} triggerClassName="kb-trigger" triggerLabel="Open first" initialFocusSelector="button">
      <button type="button">First action</button>
    </Popover>
    <Popover label="Second popover" trigger={<span>two</span>} triggerClassName="kb-trigger" triggerLabel="Open second" initialFocusSelector="button">
      <button type="button">Second action</button>
    </Popover>
  </div>;
}

describe('popover primitive', () => {
  it('opens from the trigger and exposes the dialog attributes', () => {
    render(<Surface />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(triggerButton().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(triggerButton());
    const dialog = screen.getByRole('dialog', { name: 'Test popover' });
    expect(triggerButton().getAttribute('aria-expanded')).toBe('true');
    expect(triggerButton().getAttribute('aria-haspopup')).toBe('dialog');
    expect(triggerButton().getAttribute('aria-controls')).toBe(dialog.getAttribute('id'));
    expect(dialog.className).toContain('kb-body-skin');
    expect(dialog.closest('.kb-popover-anchor.kb-anchor-skin')).toBeTruthy();
  });

  it('reports a stale-notice clear on open only', () => {
    let opens = 0;
    render(<Surface onOpen={() => { opens += 1; }} />);
    fireEvent.click(triggerButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(triggerButton());
    expect(opens).toBe(2);
  });

  it('closes on Escape, prevents the default, and returns focus to the trigger', () => {
    render(<Surface />);
    fireEvent.click(triggerButton());
    expect(screen.getByRole('button', { name: 'Inside action' })).toBe(document.activeElement);
    expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(triggerButton()).toBe(document.activeElement);
  });

  it('closes on an outside pointer on dead space and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Surface />);
    await user.click(triggerButton());
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(triggerButton()).toBe(document.activeElement);
  });

  it('leaves focus on the control an outside click landed on', async () => {
    const user = userEvent.setup();
    render(<>
      <Surface />
      <button type="button">Outside control</button>
    </>);
    await user.click(triggerButton());
    await user.click(screen.getByRole('button', { name: 'Outside control' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // An activation earns focus for itself; the dismissal must not yank it back to the trigger.
    expect(screen.getByRole('button', { name: 'Outside control' })).toBe(document.activeElement);
  });

  it('leaves focus alone for a pointer outside a closed popover', () => {
    render(<Surface />);
    fireEvent.pointerDown(document.body);
    expect(triggerButton()).not.toBe(document.activeElement);
  });

  it('ignores Escape and outside clicks while undismissable', () => {
    render(<Surface dismissable={false} />);
    fireEvent.click(triggerButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog', { name: 'Test popover' })).toBeTruthy();
  });

  it('leaves focus where it was when no initial focus selector is given', () => {
    render(<Controlled />);
    fireEvent.click(triggerButton());
    expect(screen.getByRole('dialog', { name: 'Test popover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inside action' })).not.toBe(document.activeElement);
  });

  it('closes from the trigger and restores focus', () => {
    render(<Surface />);
    fireEvent.click(triggerButton());
    fireEvent.click(triggerButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(triggerButton()).toBe(document.activeElement);
  });

  it('closes through the imperative handle without stealing focus', () => {
    render(<Controlled />);
    fireEvent.click(triggerButton());
    fireEvent.click(screen.getByRole('button', { name: 'Programmatic close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // An action inside the popover keeps focus where the click put it; only a dismiss returns it.
    expect(triggerButton()).not.toBe(document.activeElement);
  });

  it('gives Escape to the popover raised last and leaves the older one open', () => {
    render(<Pair />);
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open second' }));
    expect(screen.getByRole('dialog', { name: 'First popover' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Second popover' })).toBeTruthy();
    // Document listeners fire in registration order, so without ordering by raise time the
    // older popover - the one painted under the newer - would swallow this Escape.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Second popover' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'First popover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open second' })).toBe(document.activeElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open first' })).toBe(document.activeElement);
  });

  it('lets an older popover answer Escape once the newer one is gone', () => {
    render(<Pair />);
    fireEvent.click(screen.getByRole('button', { name: 'Open first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open second' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open second' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open first' })).toBe(document.activeElement);
  });
});
