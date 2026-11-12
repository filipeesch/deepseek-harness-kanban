// Playwright locator matchers for the DSH web test runner.
//
// The checkout that hosts these plugin-owned scenarios runs Vitest 4 and does
// not register @playwright/test's expect matchers. Each matcher below polls the
// locator like Playwright does, so the scenario templates can keep their
// locator-first assertions without requiring the host's runner setup.
import { expect } from 'vitest';
import type { Locator } from 'playwright';

const DEFAULT_TIMEOUT = 5_000;
const POLL_INTERVAL = 50;

interface MatcherOptions { timeout?: number }

function timeoutOf(options?: MatcherOptions): number {
  return options?.timeout ?? DEFAULT_TIMEOUT;
}

async function until(read: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await read()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL));
  }
}

function textOf(value: string | null): string {
  return value ?? '';
}

expect.extend({
  async toBeVisible(received: Locator, options?: MatcherOptions) {
    return { pass: await until(() => received.isVisible(), timeoutOf(options)), message: () => 'expected the locator to be visible' };
  },
  async toBeHidden(received: Locator, options?: MatcherOptions) {
    return { pass: await until(() => received.isHidden(), timeoutOf(options)), message: () => 'expected the locator to be hidden' };
  },
  async toHaveCount(received: Locator, expected: number, options?: MatcherOptions) {
    return { pass: await until(async () => (await received.count()) === expected, timeoutOf(options)), message: () => `expected the locator to have count ${expected}` };
  },
  async toContainText(received: Locator, expected: string | RegExp, options?: MatcherOptions) {
    const matches = (text: string): boolean => typeof expected === 'string' ? text.includes(expected) : expected.test(text);
    return { pass: await until(async () => matches(textOf(await received.textContent())), timeoutOf(options)), message: () => `expected the locator to contain text ${String(expected)}` };
  },
  async toHaveText(received: Locator, expected: string | RegExp, options?: MatcherOptions) {
    const matches = (text: string): boolean => typeof expected === 'string' ? text.trim() === expected : expected.test(text);
    return { pass: await until(async () => matches(textOf(await received.textContent())), timeoutOf(options)), message: () => `expected the locator to have text ${String(expected)}` };
  },
  async toHaveAttribute(received: Locator, name: string, expected: string | RegExp, options?: MatcherOptions) {
    const matches = (value: string | null): boolean => typeof expected === 'string' ? value === expected : expected.test(value ?? '');
    return { pass: await until(async () => matches(await received.getAttribute(name)), timeoutOf(options)), message: () => `expected the locator to have attribute ${name}=${String(expected)}` };
  },
  async toBeEnabled(received: Locator, options?: MatcherOptions) {
    return { pass: await until(() => received.isEnabled(), timeoutOf(options)), message: () => 'expected the locator to be enabled' };
  },
  async toBeFocused(received: Locator, options?: MatcherOptions) {
    return { pass: await until(() => received.evaluate(element => element.ownerDocument.activeElement === element), timeoutOf(options)), message: () => 'expected the locator to be focused' };
  },
  async toBeDisabled(received: Locator, options?: MatcherOptions) {
    return { pass: await until(async () => !(await received.isEnabled()), timeoutOf(options)), message: () => 'expected the locator to be disabled' };
  },
  async toHaveValue(received: Locator, expected: string, options?: MatcherOptions) {
    return { pass: await until(async () => (await received.inputValue()) === expected, timeoutOf(options)), message: () => `expected the locator to have value ${expected}` };
  },
});
