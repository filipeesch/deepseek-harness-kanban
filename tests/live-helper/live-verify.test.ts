import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error Standalone Node-native verification script intentionally has no TypeScript build step.
import {DEFAULT_COLUMNS, GUI_URL, LiveVerificationFailure, assertOfficialLaunchUrl, isCleanRoot, main, parseArgs, runVerification} from '../../scripts/live-verify.mjs';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});
// Synthetic fixture only. These tests NEVER connect/authenticate/launch a real browser.
const syntheticLogin = GUI_URL + '?token=' + 'synthetic_owner_login_fixture_123456789012345';
const options = () => ({allowOwnerTest: true, timeoutMs: 1000});
function fixture() {
  const events: string[] = [];
  let currentUrl = 'about:blank', previewVisible = false, previewDelayed = false, otherDialog = false, startupBoardVisible = false, selected = false, previewAfterSidebar = false;
  const heading = {waitFor: vi.fn(async () => {})};
  const column = {waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1)};
  const columns = {count: vi.fn(async () => 5), filter: vi.fn(() => column)};
  const board = {
    waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1),
    isVisible: vi.fn(async () => {events.push('startup-check'); return startupBoardVisible || selected;}),
    getByRole: vi.fn((role: string) => role === 'alert' ? {count: async () => 0} : heading),
    locator: vi.fn(() => columns),
    screenshot: vi.fn(async () => {events.push('board-screenshot');}),
  };
  const proceed = {count: vi.fn(async () => 1), click: vi.fn(async () => {events.push('preview-continue'); previewVisible = false;})};
  const notice = {
    count: vi.fn(async () => previewVisible ? 1 : 0),
    getByRole: vi.fn((_role: string, _options: unknown) => proceed),
    waitFor: vi.fn(async (options: {state: string; timeout: number}) => {
      if (options.state === 'visible' && previewDelayed) {await Promise.resolve(); previewVisible = true; previewDelayed = false; events.push('preview-arrived');}
      if (options.state === 'visible' && !previewVisible) throw Object.assign(new Error('Optional Preview Notice not present'), {name: 'TimeoutError'});
      if (options.state === 'hidden' && previewVisible) throw new Error('Known notice did not close');
    }),
  };
  const dialogs = {filter: vi.fn((_options: unknown) => notice)};
  const nativeDialogs = {count: vi.fn(async () => Number(previewVisible) + Number(otherDialog))};
  const sidebar = {waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), click: vi.fn(async () => {events.push('sidebar-click'); selected = true; if (previewAfterSidebar) previewVisible = true;})};
  const page = {
    goto: vi.fn(async () => {events.push('login-navigation'); currentUrl = GUI_URL;}),
    waitForURL: vi.fn(async (predicate: (url: URL) => boolean) => {if (!predicate(new URL(currentUrl))) throw new Error('Unclean redirect with a synthetic login URL');}),
    url: vi.fn(() => currentUrl),
    getByRole: vi.fn((role: string) => role === 'button' ? sidebar : role === 'dialog' ? dialogs : heading),
    locator: vi.fn((selector: string) => selector.startsWith('section.dsh-kanban') ? board : nativeDialogs),
    screenshot: vi.fn(),
    close: vi.fn(async () => {events.push('page-close');}),
  };
  const context = {
    setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
    route: vi.fn(async (_pattern: string, _handler: (route: any) => Promise<void>) => {}), newPage: vi.fn(async () => page),
    close: vi.fn(async () => {events.push('context-close');}),
  };
  const browser = {newContext: vi.fn(async () => context), close: vi.fn(async () => {events.push('browser-close');})};
  const chromium = {launch: vi.fn(async () => browser)};
  const client = {call: vi.fn(async () => ({})), close: vi.fn(async () => {events.push('inspector-close');})};
  const hostCall = vi.fn(async (_client: unknown, declaration: string): Promise<any> => {
    if (declaration.includes('authenticatedUrl')) {events.push('official-login-api'); return syntheticLogin;}
    return {hostActive: true, clientAdvertised: true};
  });
  const dependencies = {
    env: {}, loadPlaywright: vi.fn(async () => ({chromium})), connect: vi.fn(async () => client), hostCall,
    prepareScreenshot: vi.fn(async () => ({absolute: '/memory/.verification/kanban.png', relative: '.verification/kanban.png'})),
  };
  return {events, heading, column, columns, board, sidebar, page, notice, proceed, nativeDialogs, context, browser, chromium, client, dependencies,
    setUrl: (url: string) => {currentUrl = url;}, showPreview: () => {previewVisible = true;}, delayPreview: () => {previewDelayed = true;},
    showOtherDialog: () => {otherDialog = true;}, autoSelectBoard: () => {startupBoardVisible = true;}, latePreview: () => {previewAfterSidebar = true;}};
}

describe('owner authorization and pinned existing origin', () => {
  it('does not authorize or connect on help', async () => {
    expect(await main(['--help'])).toHaveProperty('help');
    expect(parseArgs(['--help'])).toMatchObject({allowOwnerTest: false});
  });
  it('requires the explicit owner-test flag before dependency/network/browser access', async () => {
    const f = fixture();
    await expect(runVerification({timeoutMs: 1000}, f.dependencies)).rejects.toThrow('owner-authorization');
    expect(f.dependencies.loadPlaywright).not.toHaveBeenCalled();
    expect(f.dependencies.connect).not.toHaveBeenCalled();
    expect(() => parseArgs([])).toThrow('owner-authorization');
  });
  it.each([
    ['--allow-owner-test', '--url', 'http://example.com/?token=synthetic'],
    ['--allow-owner-test', '--endpoint', 'http://127.0.0.1:9999'],
    ['--allow-owner-test', '--timeout-ms', '0'],
    ['--allow-owner-test', '--timeout-ms', 'Infinity'],
    ['--allow-owner-test', '--allow-owner-test'],
  ])('rejects unsafe options with fixed sanitized errors: %j', (...args) => {
    expect(() => parseArgs(args)).toThrow('stage: arguments');
  });
  it('permits only exact clean root after redirect', () => {
    expect(isCleanRoot(GUI_URL)).toBe(true);
    for (const url of [GUI_URL + '?token=synthetic', GUI_URL + '#x', GUI_URL + 'other', 'http://localhost:51781/', 'http://127.0.0.1:9999/']) expect(isCleanRoot(url)).toBe(false);
  });
  it('validates the official query without ever returning it as evidence', () => {
    expect(assertOfficialLaunchUrl(syntheticLogin)).toBeUndefined();
    for (const url of [GUI_URL, syntheticLogin + '&extra=x', syntheticLogin + '#x', syntheticLogin.replace('51781', '9999'), syntheticLogin.replace('http://', 'http://user:pass@')]) {
      expect(() => assertOfficialLaunchUrl(url)).toThrow('owner-login-url');
    }
  });
  it.each(['DEBUG','DEBUG_FILE','PWDEBUG','PLAYWRIGHT_TRACE_DIR','NODE_DEBUG','NODE_DEBUG_NATIVE','PW_TEST_DEBUG_LOG'])('rejects %s before Playwright import', async key => {
    const f = fixture(); f.dependencies.env = {[key]: 'enabled'};
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('debug-guard');
    expect(f.dependencies.loadPlaywright).not.toHaveBeenCalled();
  });
});

describe('private official login and minimal real UI flow (mocked only)', () => {
  it('checks active host/client plugin before obtaining login URL or launching a browser', async () => {
    const f = fixture(); f.dependencies.hostCall.mockResolvedValue({hostActive: false, clientAdvertised: true});
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('plugin-preflight');
    expect(f.chromium.launch).not.toHaveBeenCalled();
    expect(f.dependencies.hostCall).toHaveBeenCalledOnce();
    expect(f.client.close).toHaveBeenCalledOnce();
  });
  it('uses exactly public connection.authenticatedUrl on the pinned existing backend', async () => {
    const f = fixture(); await runVerification(options(), f.dependencies);
    const declaration = f.dependencies.hostCall.mock.calls.find(([, text]) => text.includes('authenticatedUrl'))?.[1];
    expect(declaration).toBeTypeOf('string');
    const authenticatedUrl = vi.fn(() => syntheticLogin);
    const method = new Function('return (' + declaration + ')')();
    expect(method.call({get: (key: string) => {expect(key).toBe('connection'); return {authenticatedUrl};}})).toBe(syntheticLogin);
    expect(authenticatedUrl).toHaveBeenCalledWith(GUI_URL);
    expect(declaration).not.toMatch(/browserAuth|launchToken|\.cookies|\.credentials/);
    expect(f.dependencies.connect).toHaveBeenCalledWith({endpoint: 'http://127.0.0.1:9230', timeoutMs: 1000});
  });
  it('uses an ephemeral context with no traces/HAR/video/storageState/persistent profile', async () => {
    const f = fixture(); await runVerification(options(), f.dependencies);
    expect(f.chromium.launch).toHaveBeenCalledWith({headless: true, timeout: 1000});
    expect(f.browser.newContext).toHaveBeenCalledWith({viewport: {width: 1600, height: 1000}, acceptDownloads: false, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'light'});
    expect(f.context.newPage).toHaveBeenCalledOnce();
  });
  it('real-clicks sidebar, checks exact default columns, and captures only plugin after clean URL', async () => {
    const f = fixture(), output = await runVerification(options(), f.dependencies);
    expect(f.page.getByRole).toHaveBeenCalledWith('button', {name: /^kanban$/i});
    expect(f.sidebar.click).toHaveBeenCalledOnce();
    expect(f.page.locator).toHaveBeenCalledWith('section.dsh-kanban[aria-label="Kanban"]');
    expect(f.board.getByRole).toHaveBeenCalledWith('heading', {name: 'Kanban', level: 1, exact: true});
    expect(f.columns.filter).toHaveBeenCalledTimes(5);
    expect(f.board.screenshot).toHaveBeenCalledWith({path: '/memory/.verification/kanban.png', animations: 'disabled', caret: 'hide', timeout: 1000});
    expect(f.page.screenshot).not.toHaveBeenCalled();
    expect(f.events.indexOf('sidebar-click')).toBeGreaterThan(f.events.indexOf('login-navigation'));
    expect(f.events.indexOf('board-screenshot')).toBeGreaterThan(f.events.indexOf('sidebar-click'));
    expect(output.columns).toEqual(DEFAULT_COLUMNS);
    expect(output).toMatchObject({startupUnchanged: true, previewAcknowledged: false});
    expect(f.events.indexOf('startup-check')).toBeLessThan(f.events.indexOf('sidebar-click'));
    expect(output.scope).toContain('NOT existing Desktop renderer');
    expect(JSON.stringify(output)).not.toContain('token');
    expect(JSON.stringify(output)).not.toContain('synthetic_owner');
    expect(f.events.slice(-4)).toEqual(['page-close', 'context-close', 'browser-close', 'inspector-close']);
  });
  it('fences external requests without rewriting cookies, Origin, headers, or URLs', async () => {
    const f = fixture(); await runVerification(options(), f.dependencies);
    const handler = f.context.route.mock.calls[0]?.[1] as any;
    const allowed = {request: () => ({url: () => GUI_URL + 'assets/app.js'}), continue: vi.fn(async () => {}), abort: vi.fn(async () => {})};
    await handler(allowed); expect(allowed.continue).toHaveBeenCalledWith(); expect(allowed.abort).not.toHaveBeenCalled();
    const external = {request: () => ({url: () => 'https://example.invalid/'}), continue: vi.fn(async () => {}), abort: vi.fn(async () => {})};
    await handler(external); expect(external.abort).toHaveBeenCalledWith('blockedbyclient'); expect(external.continue).not.toHaveBeenCalled();
  });
  it('does not navigate with an unexpected secret-bearing URL', async () => {
    const f = fixture(); f.dependencies.hostCall.mockImplementation(async (_client: unknown, declaration: string) => declaration.includes('authenticatedUrl') ? syntheticLogin.replace('51781', '9999') : {hostActive: true, clientAdvertised: true});
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('owner-login-url');
    expect(f.page.goto).not.toHaveBeenCalled(); expect(f.board.screenshot).not.toHaveBeenCalled();
  });
  it('does not capture evidence before a clean root redirect', async () => {
    const f = fixture(); f.page.goto.mockImplementation(async () => {f.setUrl(syntheticLogin);});
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('clean-redirect');
    expect(f.sidebar.click).not.toHaveBeenCalled(); expect(f.board.screenshot).not.toHaveBeenCalled();
  });
  it('does not create board mutations when default columns cannot be verified', async () => {
    const f = fixture(); f.columns.count.mockResolvedValue(4);
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('default-columns');
    expect(f.sidebar.click).toHaveBeenCalledOnce(); expect(f.board.screenshot).not.toHaveBeenCalled();
  });
});

describe('known Preview Notice and unchanged native startup', () => {
  it('acknowledges only the known notice through its scoped normal Continue button', async () => {
    const f = fixture(); f.showPreview();
    const output = await runVerification(options(), f.dependencies);
    expect(output).toMatchObject({previewAcknowledged: true, startupUnchanged: true});
    expect(f.page.getByRole).toHaveBeenCalledWith('heading', {name: 'Preview Notice', level: 2, exact: true});
    expect(f.notice.getByRole).toHaveBeenCalledWith('button', {name: 'Continue', exact: true});
    expect(f.proceed.click).toHaveBeenCalledOnce();
    expect(f.notice.waitFor).toHaveBeenCalledWith({state: 'hidden', timeout: 1000});
    expect(f.events.indexOf('preview-continue')).toBeLessThan(f.events.indexOf('sidebar-click'));
    expect(f.events.indexOf('preview-continue')).toBeLessThan(f.events.indexOf('board-screenshot'));
  });
  it('waits boundedly for delayed arrival instead of immediately checking and missing it', async () => {
    const f = fixture(); f.delayPreview();
    const output = await runVerification(options(), f.dependencies);
    expect(output.previewAcknowledged).toBe(true);
    expect(f.notice.waitFor).toHaveBeenCalledWith({state: 'visible', timeout: 1000});
    expect(f.events.indexOf('preview-arrived')).toBeLessThan(f.events.indexOf('preview-continue'));
  });
  it('handles a known notice that arrives after sidebar navigation before evidence', async () => {
    const f = fixture(); f.latePreview();
    const output = await runVerification(options(), f.dependencies);
    expect(output.previewAcknowledged).toBe(true);
    expect(f.events.indexOf('preview-continue')).toBeGreaterThan(f.events.indexOf('sidebar-click'));
    expect(f.events.indexOf('preview-continue')).toBeLessThan(f.events.indexOf('board-screenshot'));
  });
  it('does not click unknown dialogs or consent even if the known notice is absent', async () => {
    const f = fixture(); f.showOtherDialog();
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('native-dialog');
    expect(f.proceed.click).not.toHaveBeenCalled(); expect(f.sidebar.click).not.toHaveBeenCalled();
    expect(f.board.screenshot).not.toHaveBeenCalled();
  });
  it('does not acknowledge a known notice stacked with another native dialog', async () => {
    const f = fixture(); f.showPreview(); f.showOtherDialog();
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('preview-notice');
    expect(f.proceed.click).not.toHaveBeenCalled(); expect(f.sidebar.click).not.toHaveBeenCalled();
  });
  it('fails rather than silently accepting ambiguous Continue controls', async () => {
    const f = fixture(); f.showPreview(); f.proceed.count.mockResolvedValue(2);
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('preview-notice');
    expect(f.proceed.click).not.toHaveBeenCalled();
  });
  it('asserts the board is not visible on fresh startup before the explicit sidebar click', async () => {
    const f = fixture(); f.autoSelectBoard();
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('startup-selection');
    expect(f.board.isVisible).toHaveBeenCalledOnce(); expect(f.sidebar.click).not.toHaveBeenCalled();
    expect(f.board.screenshot).not.toHaveBeenCalled();
  });
  it('rechecks native obstruction immediately before screenshot even after evidence path setup', async () => {
    const f = fixture();
    f.dependencies.prepareScreenshot.mockImplementation(async () => {f.showOtherDialog(); return {absolute: '/memory/.verification/kanban.png', relative: '.verification/kanban.png'};});
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('native-dialog');
    expect(f.sidebar.click).toHaveBeenCalledOnce(); expect(f.board.screenshot).not.toHaveBeenCalled();
    expect(f.proceed.click).not.toHaveBeenCalled();
  });
  it('retains fixed sanitized failure labels for unexpected notice inspection errors', async () => {
    const f = fixture(); f.notice.waitFor.mockRejectedValue(new Error(syntheticLogin));
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('stage: preview-notice');
    expect(f.proceed.click).not.toHaveBeenCalled(); expect(f.board.screenshot).not.toHaveBeenCalled();
  });
});

describe('sanitized failures and bounded cleanup', () => {
  it('discards raw Playwright navigation errors including synthetic login URLs', async () => {
    const f = fixture(); f.page.goto.mockRejectedValue(new Error('Navigation failed: ' + syntheticLogin));
    let error: any;
    try {await runVerification(options(), f.dependencies);} catch (failure) {error = failure;}
    expect(error).toBeInstanceOf(LiveVerificationFailure);
    expect(String(error)).toBe('LiveVerificationFailure: Live verification failed at stage: owner-login');
    expect(error.cause).toBeUndefined(); expect(error.stack).not.toContain('synthetic_owner');
    expect(f.page.close).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce(); expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.client.close).toHaveBeenCalledOnce();
  });
  it('closes remaining resources even if one close fails, reporting only fixed cleanup stage', async () => {
    const f = fixture(); f.page.close.mockRejectedValue(new Error(syntheticLogin));
    await expect(runVerification(options(), f.dependencies)).rejects.toThrow('stage: cleanup');
    expect(f.context.close).toHaveBeenCalledOnce(); expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.client.close).toHaveBeenCalledOnce();
  });
  it('bounds acquisition and disposes a browser that resolves after its timeout', async () => {
    vi.useFakeTimers(); const f = fixture();
    let resolveBrowser: ((value: typeof f.browser) => void) | undefined;
    f.chromium.launch.mockImplementation(() => new Promise(resolve => {resolveBrowser = resolve;}));
    const result = expect(runVerification(options(), f.dependencies)).rejects.toThrow('browser-launch');
    await vi.advanceTimersByTimeAsync(1000); await result;
    expect(f.dependencies.hostCall).toHaveBeenCalledOnce();
    resolveBrowser?.(f.browser); await vi.advanceTimersByTimeAsync(0);
    expect(f.browser.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
