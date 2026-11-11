import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const HARNESS = new URL('./.tmp/index.html', import.meta.url).href;
const OUT = path.resolve('.verification');

/** The rendered colours and contrast of one element, resolving its effective background. */
function legibility(target: Locator) {
  return target.first().evaluate((element) => {
    /**
     * The plugin paints with `var(--kb-soft)`, which is a `color-mix()` around
     * `currentColor`. Asked for such a background, `getComputedStyle` hands back the
     * unresolved expression rather than a number, so it is resolved by measuring it on
     * a probe that inherits the very same context as the element being read.
     */
    const normalize = (value: string, context: Element): string => {
      if (/^rgba?\(/.test(value)) return value;
      const probe = context.ownerDocument!.createElement('span');
      probe.style.backgroundColor = value;
      context.appendChild(probe);
      const resolved = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return resolved;
    };
    // The host theme and the plugin both speak in CSS Color 4, so a computed colour
    // arrives as `rgb(...)`, `rgba(...)` or `color(srgb ...)`, with percentages and
    // `none` allowed. All of them mean the same three numbers.
    const component = (token: string, scale: number): number => {
      if (token === 'none') return 0;
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('unparsed colour component: ' + token);
      return token.endsWith('%') ? value * 2.55 : value * scale;
    };
    const channels = (value: string): [number, number, number] => {
      const rgb = /^rgba?\(([^)]+)\)$/.exec(value.trim());
      if (rgb !== null) {
        const parts = rgb[1]!.split(/[\s,/]+/).filter(token => token !== '');
        return [component(parts[0] ?? '0', 1), component(parts[1] ?? '0', 1), component(parts[2] ?? '0', 1)];
      }
      const srgb = /^color\(\s*srgb\s+([^)]+)\)$/.exec(value.trim());
      if (srgb !== null) {
        const parts = srgb[1]!.split(/[\s,/]+/).filter(token => token !== '');
        return [component(parts[0] ?? '0', 255), component(parts[1] ?? '0', 255), component(parts[2] ?? '0', 255)];
      }
      throw new Error('unresolved colour: ' + value);
    };
    const luminance = (value: string): number => {
      const [red, green, blue] = channels(value).map(channel => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    };
    const contrast = (left: string, right: string): number => {
      const a = luminance(left); const b = luminance(right);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const style = getComputedStyle(element);
    const color = normalize(style.color, element);
    let holder: Element = element;
    let background = normalize(style.backgroundColor, element);
    const clear = (value: string): boolean => value === 'rgba(0, 0, 0, 0)' || value === 'transparent';
    while (clear(background) && holder.parentElement !== null) {
      holder = holder.parentElement;
      background = normalize(getComputedStyle(holder).backgroundColor, holder);
    }
    if (clear(background)) throw new Error('nothing painted behind the element: ' + element.className);
    return { color, background, contrast: contrast(color, background) };
  });
}

async function toDark(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).toBe('');
}

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('renders the board default model control in both appearances', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model');
  const form = page.getByRole('form', { name: 'Board default model' });
  await expect(form.getByRole('heading', { name: 'Default model' })).toBeVisible();
  await expect(form.getByText('Every new conversation on this board starts on this model.')).toBeVisible();
  const picker = page.getByRole('button', { name: /^Model: / });
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveAttribute('aria-label', 'Model: DeepSeek · Reason');
  await expect(page.getByRole('button', { name: 'Save model' })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Reasoning effort' })).toBeVisible();
  await expect(page.getByText('No changes to save.')).toBeVisible();
  const pickerLight = await legibility(picker);
  expect(pickerLight, 'the model picker is rendered').not.toBeNull();
  expect(pickerLight!.contrast, 'the picker text is legible in light').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-picker-light.png') });

  // The closed control opens a searchable list of providers and routes, the way DSH's
  // own selector does, and the reload lives inside it beside the routes it refreshes.
  await picker.click();
  const list = page.getByRole('dialog', { name: 'Choose the model' });
  await expect(list).toBeVisible();
  const search = list.getByRole('combobox', { name: 'Search models' });
  await expect(search).toBeFocused();
  await expect(list.getByRole('group', { name: 'DeepSeek' })).toBeVisible();
  await expect(list.getByRole('option', { name: /Reason/ })).toHaveAttribute('aria-selected', 'true');
  await expect(list.getByRole('button', { name: 'Reload models' })).toBeVisible();
  await search.fill('chat');
  await expect(list.getByRole('option')).toHaveCount(1);
  await expect(list.getByRole('option', { name: /Chat/ })).toBeVisible();
  await page.screenshot({ path: path.join(OUT, 'board-model-picker-open-light.png') });
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();

  await toDark(page);
  const pickerDark = await legibility(page.getByRole('button', { name: /^Model: / }));
  expect(pickerDark!.contrast, 'the picker text is legible in dark').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-picker-dark.png') });
});

test('keeps the stored-model readout legible when the host dropped the route', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model&route=stale');
  const readout = page.getByRole('status').filter({ hasText: 'is not offered by this host' });
  await expect(readout).toBeVisible();
  await expect(readout).toContainText('deepseek · retired');
  await expect(page.getByRole('button', { name: /^Model: / })).toContainText('(not in the catalog)');
  const light = await legibility(readout);
  expect(light, 'the readout is rendered').not.toBeNull();
  expect(light!.contrast, 'the stored-model readout is legible in light').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-readout-light.png') });

  await toDark(page);
  await expect(readout).toBeVisible();
  const dark = await legibility(readout);
  expect(dark!.contrast, 'the stored-model readout is legible in dark').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-readout-dark.png') });
});

test('presents the fallback notice on a conversation that could not start on the board model', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HARNESS + '?scenario=board-model-notice');
  await page.getByRole('button', { name: 'Open task Short task' }).click();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByRole('button', { name: /Standard/ }).click();
  const notice = page.locator('.kb-model-notice');
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('strong')).toHaveText('Board model unavailable');
  await expect(notice).toContainText('This host does not offer deepseek · reason.');
  // The route the board wanted is named once, in the cause; the second sentence says
  // only where the conversation actually started.
  await expect(notice).toContainText('This conversation started on deepseek · chat.');
  await expect(notice.locator('p')).toHaveText('This host does not offer deepseek · reason. This conversation started on deepseek · chat.');
  // One hint, one way out: the notice offers a single dismissal and stays beside the
  // conversation it describes.
  await expect(notice.getByRole('button', { name: 'Dismiss' })).toBeVisible();
  const light = await legibility(notice.locator('p'));
  expect(light, 'the notice is rendered').not.toBeNull();
  expect(light!.contrast, 'the fallback notice is legible in light').toBeGreaterThanOrEqual(4.5);
  const lightHeading = await legibility(notice.getByRole('strong'));
  expect(lightHeading!.contrast, 'the fallback heading is legible in light').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-notice-light.png') });

  await toDark(page);
  await expect(notice).toBeVisible();
  const dark = await legibility(notice.locator('p'));
  expect(dark!.contrast, 'the fallback notice is legible in dark').toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: path.join(OUT, 'board-model-notice-dark.png') });

  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
});
