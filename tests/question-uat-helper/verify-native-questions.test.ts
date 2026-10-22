import { afterEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error Standalone Node helper intentionally has no TypeScript compilation step.
import { QuestionUatFailure, answerOwnedNativeAsk, assertAuthorizations, assertOwnedIds, assertQuietEnvironment, clientContextShape, clientSourceBaseline, clientSourceInventory, connectFreshClient, connectOwnedReload, correlateQuestionEvidence, createOwnedWorkspace, createPlan, fixtureMainSessionRequest, fixturePaths, fixtureToolGuard, fixtureWorkspaceDescriptor, installWebSocketFence, main, modelBudget, nativeAskPanel, nativeSessionId, nativeWorkspaceId, parseArgs, prepareFixture, prepareOwnedReload, provesPresentation, questionRequest, requestAllowed, requestToolEvidence, reloadOwnedClient, runReloadPreflight, runVerification, safeReport, sanitizedClientSource, sanitizedNativeAsk, sendOwnedNative, webSocketDestination } from '../../scripts/verify-native-questions.mjs';
import { call, end, ptcResult, result } from '../questions/fixtures.js';

const flags = ['--allow-owner-test', '--allow-fixture-data', '--allow-model-requests'];
const authorized = () => ({ allowOwnerTest: true, allowFixtureData: true, allowModelRequests: true, timeoutMs: 1000, modelTimeoutMs: 1000, nativePreset: 'standard', ptcPreset: 'ptc' });
afterEach(() => vi.restoreAllMocks());
// Preparation tests only. No live browser, authentication, fixture directories, native events, model requests, or profile changes.
function fakeIO() {
  const directories: string[] = [];
  return { directories, io: {
    mkdir: vi.fn(async (path: string) => { directories.push(path); }),
    lstat: vi.fn(async (): Promise<{ isDirectory: () => boolean; isSymbolicLink: () => boolean }> => ({ isDirectory: () => true, isSymbolicLink: () => false })),
    realpath: vi.fn(async (path: string) => path), writeFile: vi.fn(async () => {}),
  }, run: vi.fn(async () => ({ stdout: '', stderr: '' })) };
}

describe('G4 explicit authorization and side-effect-free preparation', () => {
  it('provides help without importing a browser or connecting to DSH', async () => {
    const dependencies = { loadPlaywright: vi.fn(), connect: vi.fn(), prepareFixture: vi.fn() };
    expect(await main(['--help'], dependencies)).toHaveProperty('help');
    for (const spy of Object.values(dependencies)) expect(spy).not.toHaveBeenCalled();
  });
  it('requires all three flags in CLI and programmatic entry points before any activity', async () => {
    const dependencies = { loadPlaywright: vi.fn(), connect: vi.fn(), prepareFixture: vi.fn() };
    for (let i = 0; i < flags.length; i++) expect(() => parseArgs(flags.filter((_, index) => index !== i))).toThrow(QuestionUatFailure);
    for (const key of ['allowOwnerTest', 'allowFixtureData', 'allowModelRequests']) await expect(runVerification({ ...authorized(), [key]: false }, dependencies)).rejects.toBeInstanceOf(QuestionUatFailure);
    expect(() => parseArgs([])).toThrow(QuestionUatFailure);
    expect(parseArgs(flags)).toMatchObject({ allowOwnerTest: true, allowFixtureData: true, allowModelRequests: true });
    for (const spy of Object.values(dependencies)) expect(spy).not.toHaveBeenCalled();
  });
  it.each(['--endpoint', '--path', '--profile', '--token', '--storage-state', '--present-as'])('refuses unauthorized target or configuration override %s', flag => {
    expect(() => parseArgs([...flags, flag, 'SYNTHETIC_SECRET'])).toThrow('stage: arguments');
  });
  it.each(['0', '999', '120001', '-1', 'NaN', 'SYNTHETIC_SECRET'])('bounds timeout %s', value => {
    expect(() => parseArgs([...flags, '--timeout-ms', value])).toThrow('stage: arguments');
  });
  it('allows existing preset IDs only as selection inputs and rejects missing or duplicate arguments', () => {
    expect(parseArgs([...flags, '--native-preset', 'existing-native', '--ptc-preset', 'existing-ptc'])).toMatchObject({ nativePreset: 'existing-native', ptcPreset: 'existing-ptc' });
    expect(() => parseArgs([...flags, '--native-preset'])).toThrow();
    expect(() => parseArgs([...flags, '--ptc-preset'])).toThrow();
    expect(() => parseArgs([...flags, '--native-preset', 'ptc'])).toThrow();
    expect(() => parseArgs([...flags, '--native-preset', '../profile'])).toThrow();
    expect(() => parseArgs([...flags, flags[0]!])).toThrow();
  });
  it('blocks debug/trace destinations before loading Playwright', async () => {
    for (const key of ['DEBUG', 'DEBUG_FILE', 'PWDEBUG', 'PLAYWRIGHT_TRACE_DIR', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE', 'PW_TEST_DEBUG_LOG']) expect(() => assertQuietEnvironment({ [key]: 'SYNTHETIC_SECRET' })).toThrow('debug-guard');
    const load = vi.fn();
    await expect(runVerification(authorized(), { env: { DEBUG: '1' }, loadPlaywright: load })).rejects.toBeInstanceOf(QuestionUatFailure);
    expect(load).not.toHaveBeenCalled();
  });
  it('sanitizes dependency failure and removes signal listeners without fixture activity', async () => {
    const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
    const connect = vi.fn(), prepare = vi.fn();
    const report = await runVerification(authorized(), { env: {}, nonce: () => 'abcdef123456', loadPlaywright: vi.fn(async () => { throw new Error('https://invalid/?token=SYNTHETIC_SECRET'); }), connect, prepareFixture: prepare });
    expect(report).toMatchObject({ gate: 'G4', ok: false, stage: 'dependency', modelRequests: { total: 0 } });
    expect(JSON.stringify(report)).not.toContain('SYNTHETIC_SECRET');
    expect(connect).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
    expect(process.listenerCount('SIGINT')).toBe(before.int); expect(process.listenerCount('SIGTERM')).toBe(before.term);
  });
});

describe('G4 fixture ownership and retained canonical paths', () => {
  it('confines fixtures to the unique G4 directory', () => {
    expect(fixturePaths('/workspace', 'abcdef123456')).toEqual({ base: '/workspace/.verification/native-fixtures/g4', run: '/workspace/.verification/native-fixtures/g4/run-abcdef123456', repo: '/workspace/.verification/native-fixtures/g4/run-abcdef123456/project', evidence: '/workspace/.verification/native-fixtures/g4/run-abcdef123456/evidence', report: '/workspace/.verification/native-fixtures/g4/run-abcdef123456/evidence/g4.json' });
    for (const nonce of ['', '../escape', 'abcdef123456/nested', 'ABCDEF123456', 'old-run']) expect(() => fixturePaths('/workspace', nonce)).toThrow('fixture-path');
  });
  it('checks permission before any fake filesystem mutation', async () => {
    const f = fakeIO();
    await expect(prepareFixture({ ...authorized(), allowFixtureData: false }, '/workspace', 'abcdef123456', f.io, f.run)).rejects.toThrow('authorization');
    expect(f.io.realpath).not.toHaveBeenCalled(); expect(f.io.mkdir).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  });
  it('uses exclusive new directories and local Git argv without ambient hooks/config/signing', async () => {
    const f = fakeIO(); const paths = await prepareFixture(authorized(), '/workspace', 'abcdef123456', f.io, f.run);
    expect(f.io.mkdir.mock.calls.find(([path]) => path === paths.run)).toEqual([paths.run]);
    expect(f.run).toHaveBeenCalledTimes(2);
    expect(f.run.mock.calls[0]?.slice(0, 2)).toEqual(['git', ['init', '--initial-branch=main', '--template=']]);
    const commit = f.run.mock.calls[1] as unknown as [string, string[], { cwd: string; env: Record<string, string> }];
    expect(commit[1]).toContain('core.hooksPath=' + paths.repo + '/.disabled-hooks'); expect(commit[1]).toContain('core.fsmonitor=false');
    expect(commit[1]).toContain('commit.gpgsign=false'); expect(commit[1]).toContain('--allow-empty');
    expect(commit[2].cwd).toBe(paths.repo); expect(commit[2].env.GIT_CONFIG_NOSYSTEM).toBe('1'); expect(commit[2].env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(commit[2].env).not.toHaveProperty('OPENAI_API_KEY'); expect(commit[2].env).not.toHaveProperty('DEEPSEEK_API_KEY'); expect(f.io.writeFile).not.toHaveBeenCalled();
  });
  it('rejects symlinks and aliased parents before Git, and never overwrites old runs', async () => {
    const linked = fakeIO(); linked.io.lstat.mockResolvedValue({ isDirectory: () => true, isSymbolicLink: () => true });
    await expect(prepareFixture(authorized(), '/workspace', 'abcdef123456', linked.io, linked.run)).rejects.toThrow('fixture-path'); expect(linked.run).not.toHaveBeenCalled();
    const alias = fakeIO(); alias.io.realpath.mockImplementation(async path => path.endsWith('.verification') ? '/outside' : path);
    await expect(prepareFixture(authorized(), '/workspace', 'abcdef123456', alias.io, alias.run)).rejects.toThrow('fixture-path'); expect(alias.run).not.toHaveBeenCalled();
    const old = fakeIO(); old.io.mkdir.mockImplementation(async path => { if (path.endsWith('run-abcdef123456')) throw new Error('existing'); });
    await expect(prepareFixture(authorized(), '/workspace', 'abcdef123456', old.io, old.run)).rejects.toThrow('existing'); expect(old.run).not.toHaveBeenCalled();
  });
  it('refuses unknown or empty cleanup identities', () => {
    const owned = new Set(['a', 'c']); expect(() => assertOwnedIds(['a', 'c'], owned)).not.toThrow();
    for (const ids of [[], ['other'], ['a', 'other'], [undefined]]) expect(() => assertOwnedIds(ids, owned)).toThrow('cleanup');
  });
});

describe('native Inspector ingest transport regression', () => {
  it('allows only GUI WS plus the configured Inspector authority and exact native /ingest path', () => {
    expect(webSocketDestination('ws://127.0.0.1:51781/ws')).toBe('gui');
    expect(webSocketDestination('ws://127.0.0.1:9230/ingest')).toBe('inspector-ingest');
    // The unchanged HTTP fence still excludes the Inspector port; WS needs its narrow separate rule.
    expect(requestAllowed('ws://127.0.0.1:9230/ingest')).toBe(false);
  });
  it.each([
    'ws://localhost:9230/ingest', 'ws://127.0.0.1:9231/ingest', 'ws://127.0.0.1:9230/ingest/',
    'ws://127.0.0.1:9230/devtools/page/example', 'ws://127.0.0.1:9230/ingest?token=SYNTHETIC_SECRET',
    'ws://127.0.0.1:9230/ingest#secret', 'ws://outside.invalid/ingest', 'wss://127.0.0.1:9230/ingest',
    'http://127.0.0.1:9230/ingest', 'ws://user:secret@127.0.0.1:9230/ingest', 'ws://127.0.0.1:9230/%69ngest',
  ])('blocks non-native WS target %s', url => { expect(webSocketDestination(url)).toBe('blocked'); });
  it('uses a block-only matcher, leaving allowed native sockets and opaque subprotocols untouched', async () => {
    const routeWebSocket = vi.fn(async (_match: (url: URL) => boolean, _handler: (socket: any) => void) => {});
    const checkpoint: any = {};
    await installWebSocketFence(authorized(), { routeWebSocket }, checkpoint);
    expect(routeWebSocket).toHaveBeenCalledTimes(1);
    const [match, handler] = routeWebSocket.mock.calls[0]!;
    expect(match(new URL('ws://127.0.0.1:9230/ingest'))).toBe(false);
    expect(match(new URL('ws://127.0.0.1:51781/ws'))).toBe(false);
    expect(match(new URL('ws://127.0.0.1:9230/wrong'))).toBe(true);
    const socket = { close: vi.fn(), connectToServer: vi.fn(), url: vi.fn() };
    handler(socket);
    expect(socket.close).toHaveBeenCalledTimes(1); expect(socket.connectToServer).not.toHaveBeenCalled(); expect(socket.url).not.toHaveBeenCalled();
    expect(checkpoint.webSockets).toEqual({ fenceInstalled: true, guiMatches: 1, inspectorIngestMatches: 1, blockedMatches: 1 });
  });
  it('checks all flags before any route metadata/action and fails closed if routing is unsupported', async () => {
    const routeWebSocket = vi.fn();
    await expect(installWebSocketFence({ ...authorized(), allowOwnerTest: false }, { routeWebSocket }, {})).rejects.toThrow('authorization');
    expect(routeWebSocket).not.toHaveBeenCalled();
    await expect(installWebSocketFence(authorized(), {}, {})).rejects.toThrow('browser');
  });
});

const onceWait = async (read: () => Promise<any>, predicate: (value: any) => boolean) => { const value = await read(); if (!predicate(value)) throw new Error('bounded synthetic wait'); return value; };
function sourceFixture(options: { failMethod?: string; inventory?: any; root?: any; services?: boolean; pageOrigin?: number; runtimeOrigin?: number } = {}) {
  const root = options.root ?? { children: [{ localName: 'host' }, { localName: 'clients', children: [{ localName: 'client', children: [{ localName: 'context', nodeId: 7, privateData: 'SYNTHETIC_SECRET' }] }] }] };
  const inventory = options.inventory ?? { sources: [{ kind: 'host', sourceId: 'host', generation: 'host-generation' }, { kind: 'client', sourceId: 'old', generation: 'old-generation' }, { kind: 'client', sourceId: 'fresh', generation: 'fresh-generation', label: 'SYNTHETIC_SECRET' }] };
  const host = { call: vi.fn(async (_: string) => inventory) };
  const client = { call: vi.fn(async (method: string, _params?: unknown): Promise<any> => {
    if (method === options.failMethod) throw new Error('ws://invalid/?token=SYNTHETIC_SECRET');
    if (method === 'DOM.getDocument') return { root };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'private-runtime-handle' } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: { hasSessions: options.services !== false, hasUiWorkspace: options.services !== false, timeOriginMs: options.runtimeOrigin ?? 100 } } };
    return {};
  }), close: vi.fn(async () => {}) };
  const connect = vi.fn(async (_: unknown) => client);
  const checkpoint: any = {};
  const page = { url: vi.fn(() => 'http://127.0.0.1:51781/'), evaluate: vi.fn(async () => options.pageOrigin ?? 100), reload: vi.fn(async (_?: unknown) => {}) };
  return { host, client, connect, checkpoint, page, before: new Set(['host', 'old']), wait: onceWait };
}
describe('sanitized, bounded client-source checkpoints (no native probes)', () => {
  it('counts source shapes without exposing IDs, labels, URLs, capabilities or context data', () => {
    const inventory = clientSourceInventory({ sources: [{ kind: 'host', sourceId: 'private-host' }, { kind: 'client', sourceId: 'old' }, { kind: 'client', sourceId: 'SYNTHETIC_SECRET', label: 'SYNTHETIC_SECRET' }] }, new Set(['old']));
    expect(inventory).toEqual({ shape: 'sources-array', sourceCount: 3, hostCount: 1, clientCount: 2, freshClientCount: 1, invalidRowCount: 0 });
    expect(JSON.stringify(inventory)).not.toContain('SYNTHETIC_SECRET');
    expect(clientSourceInventory({ sources: {} }).shape).toBe('invalid');
    expect(clientSourceInventory({ sources: [null] }).invalidRowCount).toBe(1);
    expect(clientContextShape({ children: [{ localName: 'clients', children: [{ localName: 'client', children: [{ localName: 'context', raw: 'SYNTHETIC_SECRET' }] }] }] })).toEqual({ rootPresent: true, clientsBranches: 1, clientNodes: 1, contextNodes: 1 });
  });
  it('rechecks authorization before baseline inventory or any fresh-client query', async () => {
    const f = sourceFixture();
    await expect(clientSourceBaseline({ ...authorized(), allowFixtureData: false }, f.host, f.checkpoint)).rejects.toThrow('authorization');
    await expect(connectFreshClient({ ...authorized(), allowModelRequests: false }, f)).rejects.toThrow('authorization');
    expect(f.host.call).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it('captures a private baseline Set while reporting only shape/count metadata', async () => {
    const f = sourceFixture(); const before = await clientSourceBaseline(authorized(), f.host, f.checkpoint);
    expect([...before]).toEqual(['host', 'old', 'fresh']); expect(f.checkpoint.point).toBe('baseline-inventory'); expect(f.checkpoint.baselineSourceCount).toBe(3);
    expect(JSON.stringify(sanitizedClientSource(f.checkpoint))).not.toContain('"fresh"');
    expect(f.checkpoint.inventory.freshClientCount).toBe(0);
  });
  it.each([
    [{ sources: [{ kind: 'host', sourceId: 'host' }, { kind: 'client', sourceId: 'old' }] }, 'no-fresh-source'],
    [{ sources: [{ kind: 'client', sourceId: 'new-a' }, { kind: 'client', sourceId: 'new-b' }] }, 'ambiguous-fresh-sources'],
    [{ sources: {} }, 'invalid-inventory'], [{ sources: [null] }, 'invalid-inventory'],
  ])('bounds discovery failure %j as %s without connecting', async (inventory, outcome) => {
    const f = sourceFixture({ inventory });
    await expect(connectFreshClient(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint).toMatchObject({ point: 'discovery', outcome, runtimeEnabled: false, contextResolved: false }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('distinguishes inventory RPC and connection failures without raw errors', async () => {
    const inventory = sourceFixture(); inventory.host.call.mockRejectedValue(new Error('SYNTHETIC_SECRET'));
    await expect(connectFreshClient(authorized(), inventory)).rejects.toThrow('client-source'); expect(inventory.checkpoint.outcome).toBe('inventory-call-failed');
    const connect = sourceFixture(); connect.connect.mockRejectedValue(new Error('SYNTHETIC_SECRET'));
    await expect(connectFreshClient(authorized(), connect)).rejects.toThrow('client-source'); expect(connect.checkpoint).toMatchObject({ point: 'connect', outcome: 'connect-failed' });
    expect(JSON.stringify(sanitizedClientSource(connect.checkpoint))).not.toContain('SYNTHETIC_SECRET');
  });
  it.each([
    ['Runtime.enable', 'runtime-enable', 'runtime-enable-failed'], ['DOM.getDocument', 'context-document', 'context-shape-invalid'],
    ['DOM.resolveNode', 'context-resolve', 'context-resolve-failed'], ['Runtime.callFunctionOn', 'context-services', 'context-services-unavailable'],
  ])('identifies %s failure and closes only its just-created Inspector connection', async (failMethod, point, outcome) => {
    const f = sourceFixture({ failMethod });
    await expect(connectFreshClient(authorized(), f)).rejects.toThrow('client-source'); expect(f.checkpoint).toMatchObject({ point, outcome }); expect(f.client.close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sanitizedClientSource(f.checkpoint))).not.toContain('SYNTHETIC_SECRET');
  });
  it('bounds missing/ambiguous semantic context and unavailable client services before fixture writes', async () => {
    const missing = sourceFixture({ root: { children: [] } });
    await expect(connectFreshClient(authorized(), missing)).rejects.toThrow('client-source'); expect(missing.checkpoint.outcome).toBe('context-shape-invalid'); expect(missing.checkpoint.context.clientNodes).toBe(0);
    const ambiguous = sourceFixture({ root: { children: [{ localName: 'clients', children: [{ localName: 'client' }, { localName: 'client' }] }] } });
    await expect(connectFreshClient(authorized(), ambiguous)).rejects.toThrow('client-source'); expect(ambiguous.checkpoint.outcome).toBe('context-shape-invalid'); expect(ambiguous.client.call.mock.calls.some(([name]) => name === 'DOM.resolveNode')).toBe(false);
    const services = sourceFixture({ services: false }); await expect(connectFreshClient(authorized(), services)).rejects.toThrow('client-source'); expect(services.checkpoint.outcome).toBe('context-services-unavailable');
  });
  it('selects exactly the fresh source, enables Runtime, resolves its one context and checks public services', async () => {
    const f = sourceFixture();
    expect(await connectFreshClient(authorized(), f)).toBe(f.client);
    expect(f.connect).toHaveBeenCalledExactlyOnceWith({ endpoint: 'http://127.0.0.1:9230', timeoutMs: 1000, client: 'fresh' });
    expect(f.checkpoint).toMatchObject({ point: 'ready', outcome: 'ready', runtimeEnabled: true, contextResolved: true, servicesReady: true, inventory: { freshClientCount: 1 }, context: { clientNodes: 1, contextNodes: 1 } });
    expect(f.client.close).not.toHaveBeenCalled();
  });
  it('strips every diagnostic raw field and only reports fixed enums/booleans/counts', () => {
    const secret = 'SYNTHETIC_SECRET'; const report = safeReport({ clientSource: { phase: 'reload', point: 'context-resolve', outcome: 'context-resolve-failed', inventory: { shape: 'sources-array', sourceCount: 2, freshClientCount: 1, sources: secret }, context: { rootPresent: true, clientNodes: 1, objectId: secret }, webSockets: { fenceInstalled: true, inspectorIngestMatches: 1, protocol: secret }, rawError: secret, url: secret, sourceId: secret } });
    expect(report.clientSource).toMatchObject({ phase: 'reload', point: 'context-resolve', outcome: 'context-resolve-failed', inventory: { sourceCount: 2, freshClientCount: 1 }, webSockets: { inspectorIngestMatches: 1 } });
    expect(report.ok).toBe(false); expect(JSON.stringify(report)).not.toContain(secret);
  });
});

const reloadInventory = (generation = 'next-generation', sourceId = 'fresh') => ({ sources: [{ kind: 'host', sourceId: 'host', generation: 'host-generation' }, { kind: 'client', sourceId: 'old', generation: 'old-generation' }, { kind: 'client', sourceId, generation }] });
async function ownedReloadFixture() {
  const f = sourceFixture(); await connectFreshClient(authorized(), f);
  const proof = await prepareOwnedReload(authorized(), f);
  f.page.evaluate.mockResolvedValue(200); f.host.call.mockResolvedValue(reloadInventory());
  const next = sourceFixture({ runtimeOrigin: 200 }).client; f.connect.mockResolvedValue(next); f.connect.mockClear();
  return { ...f, proof, next };
}
describe('proof-bound same-tab source reuse across reload (synthetic metadata only)', () => {
  it('keeps first attach uniquely NEW even if a baseline client has matching document/generation', async () => {
    const f = sourceFixture(); f.before.add('fresh');
    await expect(connectFreshClient(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint).toMatchObject({ selection: 'unique-new', outcome: 'no-fresh-source' }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('requires initial selected Runtime to match the owned Page document before issuing a lease', async () => {
    const f = sourceFixture({ runtimeOrigin: 999 });
    await expect(connectFreshClient(authorized(), f)).rejects.toThrow('client-source'); expect(f.checkpoint.outcome).toBe('document-mismatch');
    f.host.call.mockClear(); await expect(prepareOwnedReload(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('reload-proof-invalid'); expect(f.host.call).not.toHaveBeenCalled();
  });
  it('rejects missing initial public generation metadata before connecting', async () => {
    const f = sourceFixture({ inventory: { sources: [{ kind: 'client', sourceId: 'fresh' }] } });
    await expect(connectFreshClient(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('source-generation-unavailable'); expect(f.connect).not.toHaveBeenCalled();
  });
  it('accepts only the captured source ID with a changed active generation and new matching document', async () => {
    const f = await ownedReloadFixture(); expect(await connectOwnedReload(authorized(), f)).toBe(f.next);
    expect(f.connect).toHaveBeenCalledExactlyOnceWith({ endpoint: 'http://127.0.0.1:9230', timeoutMs: 1000, client: 'fresh' });
    expect(f.checkpoint).toMatchObject({ phase: 'reload', selection: 'known-reload', outcome: 'ready', knownSourceCount: 1, generationChanged: true, documentChanged: true, documentMatched: true, sourceMatched: true, inventory: { freshClientCount: 0 }, runtimeEnabled: true, contextResolved: true, servicesReady: true });
    const serialized = JSON.stringify(sanitizedClientSource(f.checkpoint)); expect(serialized).not.toContain('next-generation'); expect(serialized).not.toContain('timeOrigin'); expect(serialized).not.toContain('"fresh"');
  });
  it('rejects a forged baseline-source fallback or a different Page before any metadata', async () => {
    const f = sourceFixture();
    await expect(connectOwnedReload(authorized(), { ...f, proof: { sourceId: 'old', generation: 'old-generation' } })).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('reload-proof-invalid'); expect(f.host.call).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
    await connectFreshClient(authorized(), f); const proof = await prepareOwnedReload(authorized(), f); f.host.call.mockClear();
    const otherPage = sourceFixture().page;
    await expect(connectOwnedReload(authorized(), { ...f, proof, page: otherPage })).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('reload-proof-invalid'); expect(f.host.call).not.toHaveBeenCalled(); expect(otherPage.evaluate).not.toHaveBeenCalled();
  });
  it.each(['old', 'unrelated-new-client'])('never falls back to %s when the exact owned source is absent', async sourceId => {
    const f = await ownedReloadFixture(); f.host.call.mockResolvedValue({ sources: [{ kind: 'host', sourceId: 'host', generation: 'h' }, { kind: 'client', sourceId, generation: 'new-generation' }] });
    await expect(connectOwnedReload(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint).toMatchObject({ outcome: 'owned-source-unavailable', knownSourceCount: 0 }); expect(f.connect).not.toHaveBeenCalled();
  });
  it('rejects unchanged document or stale retained generation instead of calling it a reload', async () => {
    const document = await ownedReloadFixture(); document.page.evaluate.mockResolvedValue(100);
    await expect(connectOwnedReload(authorized(), document)).rejects.toThrow('client-source'); expect(document.checkpoint.outcome).toBe('document-mismatch'); expect(document.connect).not.toHaveBeenCalled();
    const generation = await ownedReloadFixture(); generation.host.call.mockResolvedValue(reloadInventory('fresh-generation'));
    await expect(connectOwnedReload(authorized(), generation)).rejects.toThrow('client-source'); expect(generation.checkpoint.outcome).toBe('stale-source-generation'); expect(generation.connect).not.toHaveBeenCalled();
  });
  it('captures the latest generation immediately before reload, not a stale first-attach value', async () => {
    const f = sourceFixture(); await connectFreshClient(authorized(), f);
    f.host.call.mockResolvedValue(reloadInventory('transport-reconnected')); const proof = await prepareOwnedReload(authorized(), f); f.page.evaluate.mockResolvedValue(200); f.connect.mockClear();
    await expect(connectOwnedReload(authorized(), { ...f, proof })).rejects.toThrow('client-source'); expect(f.checkpoint.outcome).toBe('stale-source-generation'); expect(f.connect).not.toHaveBeenCalled();
  });
  it('requires the new Runtime document, not just changed registry generation', async () => {
    const f = await ownedReloadFixture(); const stale = sourceFixture({ runtimeOrigin: 100 }).client; f.connect.mockResolvedValue(stale);
    await expect(connectOwnedReload(authorized(), f)).rejects.toThrow('client-source'); expect(f.checkpoint.outcome).toBe('document-mismatch'); expect(stale.close).toHaveBeenCalledTimes(1);
  });
  it('waits boundedly for fresh published context after a stale generation object is discarded', async () => {
    const f = await ownedReloadFixture(); const original = f.next.call.getMockImplementation()!; let documents = 0;
    f.next.call.mockImplementation(async (method, params) => { if (method === 'DOM.getDocument' && ++documents === 1) throw new Error('stale retained object'); return original(method, params); });
    const wait = async (read: () => Promise<any>, predicate: (value: any) => boolean) => { for (let i = 0; i < 2; i++) { const value = await read(); if (predicate(value)) return value; } throw new Error('bounded'); };
    expect(await connectOwnedReload(authorized(), { ...f, wait })).toBe(f.next); expect(documents).toBe(2); expect(f.checkpoint.documentMatched).toBe(true);
  });
  it('rejects generation replacement during Runtime validation', async () => {
    const f = await ownedReloadFixture(); f.host.call.mockResolvedValueOnce(reloadInventory()).mockResolvedValueOnce(reloadInventory('changed-during-validation'));
    await expect(connectOwnedReload(authorized(), f)).rejects.toThrow('client-source'); expect(f.checkpoint.outcome).toBe('source-generation-changed'); expect(f.next.close).toHaveBeenCalledTimes(1);
  });
  it('requires every authorization before page, source metadata, or reload actions', async () => {
    const f = sourceFixture(); const bad = { ...authorized(), allowOwnerTest: false };
    await expect(prepareOwnedReload(bad, f)).rejects.toThrow('authorization'); await expect(connectOwnedReload(bad, { ...f, proof: {} })).rejects.toThrow('authorization'); await expect(reloadOwnedClient(bad, f)).rejects.toThrow('authorization');
    expect(f.host.call).not.toHaveBeenCalled(); expect(f.page.evaluate).not.toHaveBeenCalled(); expect(f.page.reload).not.toHaveBeenCalled(); expect(f.connect).not.toHaveBeenCalled();
  });
  it('supports a second proof-bound reload from the newly issued client lease', async () => {
    const f = await ownedReloadFixture(); const first = await connectOwnedReload(authorized(), f);
    const proof = await prepareOwnedReload(authorized(), { ...f, client: first });
    f.page.evaluate.mockResolvedValue(300); f.host.call.mockResolvedValue(reloadInventory('third-generation'));
    const third = sourceFixture({ runtimeOrigin: 300 }).client; f.connect.mockResolvedValue(third);
    expect(await connectOwnedReload(authorized(), { ...f, proof })).toBe(third);
    expect(f.checkpoint).toMatchObject({ selection: 'known-reload', generationChanged: true, documentChanged: true, documentMatched: true, outcome: 'ready' });
  });
  it('rejects an unexpected document change before issuing the reload proof', async () => {
    const f = sourceFixture(); await connectFreshClient(authorized(), f); f.page.evaluate.mockResolvedValue(150); f.host.call.mockClear();
    await expect(prepareOwnedReload(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('document-mismatch'); expect(f.host.call).not.toHaveBeenCalled();
  });
  it('rejects a known source whose current public generation is missing', async () => {
    const f = await ownedReloadFixture(); f.host.call.mockResolvedValue({ sources: [{ kind: 'client', sourceId: 'fresh' }] });
    await expect(connectOwnedReload(authorized(), f)).rejects.toThrow('client-source');
    expect(f.checkpoint.outcome).toBe('source-generation-unavailable'); expect(f.connect).not.toHaveBeenCalled();
  });
  it('performs one same-Page reload and obtains fresh context/services without any model calls', async () => {
    const f = sourceFixture(); await connectFreshClient(authorized(), f); const next = sourceFixture({ runtimeOrigin: 200 }).client;
    f.page.reload.mockImplementation(async () => { f.page.evaluate.mockResolvedValue(200); f.host.call.mockResolvedValue(reloadInventory()); f.connect.mockResolvedValue(next); });
    expect(await reloadOwnedClient(authorized(), f)).toBe(next); expect(f.page.reload).toHaveBeenCalledExactlyOnceWith({ waitUntil: 'domcontentloaded', timeout: 1000 }); expect(f.client.close).toHaveBeenCalledTimes(1);
    const request = await prepareOwnedReload(authorized(), { ...f, client: next }); expect(request).toEqual({});
    const used = await ownedReloadFixture(); await connectOwnedReload(authorized(), used); used.host.call.mockClear();
    await expect(connectOwnedReload(authorized(), used)).rejects.toThrow('client-source'); expect(used.checkpoint.outcome).toBe('reload-proof-invalid'); expect(used.host.call).not.toHaveBeenCalled();
  });
});

describe('zero-model reload preflight barrier before fixture creation', () => {
  it('cannot invoke fixture/workspace/model work if the owned reload identity check fails', async () => {
    const f = sourceFixture(); await connectFreshClient(authorized(), f);
    const fixtureWrite = vi.fn(), workspaceWrite = vi.fn(), modelRequest = vi.fn();
    const afterReady = vi.fn(async () => { fixtureWrite(); workspaceWrite(); modelRequest(); });
    // No document/generation change: emulate a failed same-tab reload without any browser.
    await expect(runReloadPreflight(authorized(), f, afterReady)).rejects.toThrow('client-source');
    expect(f.checkpoint.purpose).toBe('preflight'); expect(f.checkpoint.outcome).toBe('document-mismatch');
    expect(f.client.close).toHaveBeenCalledTimes(1); expect(f.page.reload).toHaveBeenCalledTimes(1);
    expect(afterReady).not.toHaveBeenCalled(); expect(fixtureWrite).not.toHaveBeenCalled(); expect(workspaceWrite).not.toHaveBeenCalled(); expect(modelRequest).not.toHaveBeenCalled();
  });
  it('admits fixture preparation only after the exact owned source/new document/services are ready', async () => {
    const f = sourceFixture(); await connectFreshClient(authorized(), f); const next = sourceFixture({ runtimeOrigin: 200 }).client;
    f.page.reload.mockImplementation(async () => { f.page.evaluate.mockResolvedValue(200); f.host.call.mockResolvedValue(reloadInventory()); f.connect.mockResolvedValue(next); });
    const modelRequest = vi.fn(); const fixtureWrite = vi.fn(async (client: unknown) => {
      expect(client).toBe(next); expect(f.checkpoint).toMatchObject({ purpose: 'preflight', outcome: 'ready', documentMatched: true, documentChanged: true, generationChanged: true, servicesReady: true });
      return 'fixture-created-after-proof';
    });
    expect(await runReloadPreflight(authorized(), f, fixtureWrite)).toBe('fixture-created-after-proof');
    expect(fixtureWrite).toHaveBeenCalledTimes(1); expect(modelRequest).not.toHaveBeenCalled(); expect(f.client.close).toHaveBeenCalledTimes(1);
  });
  it('checks all flags before metadata/reload and closes the new CDP on downstream preparation failure', async () => {
    const unowned = sourceFixture(); const fixture = vi.fn();
    await expect(runReloadPreflight({ ...authorized(), allowModelRequests: false }, unowned, fixture)).rejects.toThrow('authorization');
    expect(unowned.host.call).not.toHaveBeenCalled(); expect(unowned.page.reload).not.toHaveBeenCalled(); expect(fixture).not.toHaveBeenCalled();
    const f = sourceFixture(); await connectFreshClient(authorized(), f); const next = sourceFixture({ runtimeOrigin: 200 }).client;
    f.page.reload.mockImplementation(async () => { f.page.evaluate.mockResolvedValue(200); f.host.call.mockResolvedValue(reloadInventory()); f.connect.mockResolvedValue(next); });
    await expect(runReloadPreflight(authorized(), f, vi.fn(async () => { throw new Error('fixture failure'); }))).rejects.toThrow('fixture failure');
    expect(f.client.close).toHaveBeenCalledTimes(1); expect(next.close).toHaveBeenCalledTimes(1);
  });
});

function nativeAskFixture(values: { id?: string; panels?: number; radios?: number; submits?: number } = {}) {
  const radio = { count: vi.fn(async () => values.radios ?? 1), click: vi.fn(async () => {}) };
  const submit = { count: vi.fn(async () => values.submits ?? 1), click: vi.fn(async (_?: unknown) => {}) };
  const panel = { count: vi.fn(async () => values.panels ?? 1), waitFor: vi.fn(async () => {}), getByRole: vi.fn((role: string) => role === 'radio' ? radio : submit) };
  const heading = { rootFree: true }; const candidates = { filter: vi.fn(() => panel) };
  const root = { count: vi.fn(async () => 1), getAttribute: vi.fn(async () => values.id ?? 'owned-c'), locator: vi.fn(() => candidates), getByText: vi.fn(() => { throw new Error('Do not nest the owning root in a has locator'); }) };
  const page = { getByRole: vi.fn(() => heading) }; const checkpoint: any = {};
  return { root, page, checkpoint, sessionId: 'owned-c', question: 'Unique owned question', candidates, heading, radio, submit, panel };
}
describe('strict outer native root with a root-free relative panel heading', () => {
  it('keeps the own-session root only outside the relative has locator', () => {
    const f = nativeAskFixture(); expect(nativeAskPanel(f.page, f.root, f.question)).toBe(f.panel);
    expect(f.root.locator).toHaveBeenCalledExactlyOnceWith('[data-question-key]');
    expect(f.page.getByRole).toHaveBeenCalledExactlyOnceWith('heading', { name: f.question, exact: true });
    expect(f.candidates.filter).toHaveBeenCalledExactlyOnceWith({ has: f.heading }); expect(f.root.getByText).not.toHaveBeenCalled();
  });
  it('performs one normal Confirmed choice and trial/real Submit only inside the unique own panel', async () => {
    const f = nativeAskFixture(); expect(await answerOwnedNativeAsk(authorized(), f)).toEqual({ panelCount: 1, correctScope: true });
    expect(f.checkpoint).toMatchObject({ point: 'result', outcome: 'pending', panelCount: 1, radioCount: 1, submitCount: 1, radioClicked: true, submitClicked: true });
    expect(f.radio.click).toHaveBeenCalledTimes(1); expect(f.submit.click.mock.calls).toEqual([[{ trial: true }], []]);
  });
  it('requires all consent flags and the exact native root before constructing or clicking a panel', async () => {
    const f = nativeAskFixture(); await expect(answerOwnedNativeAsk({ ...authorized(), allowModelRequests: false }, f)).rejects.toThrow('authorization'); expect(f.root.count).not.toHaveBeenCalled();
    const wrong = nativeAskFixture({ id: 'unowned' }); await expect(answerOwnedNativeAsk(authorized(), wrong)).rejects.toThrow('native-ask'); expect(wrong.checkpoint.outcome).toBe('wrong-scope'); expect(wrong.root.locator).not.toHaveBeenCalled();
  });
  it('records duplicate or unavailable panel/radio/Submit checkpoints without a broad fallback', async () => {
    const duplicate = nativeAskFixture({ panels: 2 }); await expect(answerOwnedNativeAsk(authorized(), duplicate)).rejects.toThrow('native-ask'); expect(duplicate.checkpoint.outcome).toBe('panel-ambiguous'); expect(duplicate.radio.click).not.toHaveBeenCalled();
    const missing = nativeAskFixture({ panels: 0 }); await expect(answerOwnedNativeAsk(authorized(), missing)).rejects.toThrow('native-ask'); expect(missing.checkpoint.outcome).toBe('panel-ambiguous');
    const radio = nativeAskFixture({ radios: 0 }); await expect(answerOwnedNativeAsk(authorized(), radio)).rejects.toThrow('native-ask'); expect(radio.checkpoint.outcome).toBe('radio-unavailable'); expect(radio.submit.click).not.toHaveBeenCalled();
    const submit = nativeAskFixture({ submits: 0 }); await expect(answerOwnedNativeAsk(authorized(), submit)).rejects.toThrow('native-ask'); expect(submit.checkpoint.outcome).toBe('submit-unavailable'); expect(submit.submit.click).not.toHaveBeenCalled();
  });
  it('emits only fixed diagnostic enums/counts/booleans, never text, arguments, errors or IDs', () => {
    const safe = sanitizedNativeAsk({ point: 'panel', outcome: 'panel-unavailable', panelCount: 0, rawError: 'SYNTHETIC_SECRET', question: 'SYNTHETIC_SECRET', callId: 'SYNTHETIC_SECRET' });
    expect(safe).toMatchObject({ point: 'panel', outcome: 'panel-unavailable', panelCount: 0 }); expect(JSON.stringify(safe)).not.toContain('SYNTHETIC_SECRET');
    expect(safeReport({ nativeAsk: { ...safe, args: 'SYNTHETIC_SECRET' } }).nativeAsk).toEqual(safe);
  });
});

describe('source-backed native ID namespaces', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  it('admits exactly native session-UUID IDs and preserves both fixture sessions in reports', () => {
    expect(nativeSessionId('session-' + first)).toBe('session-' + first);
    for (const bad of [first, 'workspace-' + first, 'agent-' + first, 'session-session-' + first, 'session-' + first + '/other', 'session-SYNTHETIC_SECRET']) expect(nativeSessionId(bad)).toBeUndefined();
    const report = safeReport({ ids: { C: 'session-' + first, A: 'session-' + second, workspace: first, project: first, task: second } });
    expect(report.ids).toEqual({ C: 'session-' + first, A: 'session-' + second, workspace: first, project: first, task: second });
    expect(safeReport({ ids: { C: first, A: 'other-' + first, workspace: 'workspace-' + first } }).ids).toEqual({});
  });
  it('keeps WorkspaceRegistry randomUUID IDs bare instead of guessing a workspace prefix', () => {
    expect(nativeWorkspaceId(first)).toBe(first);
    expect(nativeWorkspaceId('workspace-' + first)).toBeUndefined();
    expect(nativeWorkspaceId('session-' + first)).toBeUndefined();
  });
});

// Redacted projections of public request/header fixtures only, never appended to DSH.
const header = (seq: number, names: string[]) => ({ type: 'request/header', seq, data: { header: { tools: names.map(name => ({ name })) } } });
describe('actual canonical requestHeader.tools, not the registry catalog', () => {
  it('proves direct Native from the assembled header in force for the actual question call', () => {
    const rows = requestToolEvidence([header(1, ['decision_request', 'ask_user_question', 'SYNTHETIC_SECRET']), call(2, 7, 'call-native')], 7, 'decision_request');
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ headerSeq: 1, callSeq: 2, turn: 7, step: 0, toolCount: 3, hasDecisionRequest: true, hasRunCode: false, onlyRunCode: false });
    expect(provesPresentation(rows, 'native')).toBe(true); expect(provesPresentation(rows, 'ptc')).toBe(false);
    expect(JSON.stringify(rows)).not.toContain('SYNTHETIC_SECRET');
  });
  it('proves collapsed PTC only when the actual request has exactly run_code', () => {
    const catalog = { type: 'catalog-only', seq: 0, data: { tools: ['decision_request', 'run_code', 'ask_user_question'] } };
    const rows = requestToolEvidence([catalog, header(1, ['run_code']), call(2, 9, 'root', 'run_code')], 9, 'run_code');
    expect(rows[0]).toMatchObject({ headerSeq: 1, toolCount: 1, hasRunCode: true, hasDecisionRequest: false, onlyRunCode: true });
    expect(provesPresentation(rows, 'ptc')).toBe(true);
    const notCollapsed = requestToolEvidence([header(1, ['run_code', 'decision_request']), call(2, 9, 'root', 'run_code')], 9, 'run_code');
    expect(provesPresentation(notCollapsed, 'ptc')).toBe(false);
    expect(provesPresentation(requestToolEvidence([catalog, call(2, 9, 'root', 'run_code')], 9, 'run_code'), 'ptc')).toBe(false);
  });
  it('inherits unchanged full snapshots and folds later headers without guessing missing ones', () => {
    const events = [header(1, ['run_code']), call(2, 1, 'first', 'run_code'), end(3, 1), call(4, 2, 'second', 'run_code'), header(5, ['decision_request']), call(6, 3, 'third')];
    expect(requestToolEvidence(events, 2, 'run_code')[0].headerSeq).toBe(1);
    expect(provesPresentation(requestToolEvidence(events, 2, 'run_code'), 'ptc')).toBe(true);
    expect(requestToolEvidence([...events].reverse(), 3, 'decision_request')[0].headerSeq).toBe(5);
    expect(provesPresentation(requestToolEvidence(events, 3, 'decision_request'), 'native')).toBe(true);
    expect(requestToolEvidence([call(2, 1, 'missing'), header(3, ['decision_request'])], 1, 'decision_request')).toEqual([]);
    expect(requestToolEvidence([call(2, 1, 'missing')], 1, 'decision_request')).toEqual([]);
  });
  it('clears absent/empty tool snapshots and rejects malformed headers instead of retaining stale proof', () => {
    for (const replacement of [{ type: 'request/header', seq: 3, data: { header: {} } }, header(3, []), { type: 'request/header', seq: 3, data: { header: { tools: [{}] } } }]) {
      const rows = requestToolEvidence([header(1, ['decision_request']), replacement, call(4, 1, 'c')], 1, 'decision_request');
      expect(provesPresentation(rows, 'native')).toBe(false); expect(provesPresentation(rows, 'ptc')).toBe(false);
    }
    expect(provesPresentation([], 'native')).toBe(false);
    expect(provesPresentation(undefined, 'ptc')).toBe(false);
  });
  it('records only hashed call correlation and boolean/count wire evidence, never raw config/schemas', () => {
    const rows = requestToolEvidence([header(1, ['decision_request']), call(2, 7, 'call-native')], 7, 'decision_request');
    const report = safeReport({ wire: { native: [{ ...rows[0], config: 'SYNTHETIC_SECRET', tools: ['SYNTHETIC_SECRET'] }] } });
    expect(report.wire.native).toEqual(rows); expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain('SYNTHETIC_SECRET');
    expect(safeReport({ wire: { native: [{ ...rows[0], callIdHash: 'invalid' }] } }).wire.native).toEqual([]);
  });
});

describe('owned native Workspace preparation for ordinary main C', () => {
  const nonce = 'abcdef123456';
  const id = '11111111-1111-4111-8111-111111111111';
  const paths = () => fixturePaths('/workspace', nonce);
  const metadata = () => ({ id, path: paths().repo, title: 'G4 fixture ' + nonce + ' workspace', sessionIds: [] as string[] });
  const registry = () => ({ resolveByPath: vi.fn(async () => null as unknown), create: vi.fn(async () => metadata()) });
  it('requires every authorization before registry or path metadata access', async () => {
    const api = registry(); const read = vi.fn();
    const guarded = new Proxy(paths(), { get(target, key) { read(key); return target[key as keyof typeof target]; } });
    for (const key of ['allowOwnerTest', 'allowFixtureData', 'allowModelRequests']) await expect(createOwnedWorkspace({ ...authorized(), [key]: false }, guarded, nonce, api)).rejects.toThrow('authorization');
    expect(read).not.toHaveBeenCalled(); expect(api.resolveByPath).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
  });
  it('registers only its certified canonical path with the unique fixture title', async () => {
    const api = registry(); const expected = { id, path: paths().repo, title: metadata().title };
    expect(fixtureWorkspaceDescriptor(paths(), nonce)).toEqual({ path: expected.path, title: expected.title });
    expect(await createOwnedWorkspace(authorized(), paths(), nonce, api)).toEqual(expected);
    expect(api.resolveByPath).toHaveBeenCalledExactlyOnceWith(expected.path);
    expect(api.create).toHaveBeenCalledExactlyOnceWith(expected.path, expected.title);
  });
  it('never reuses or retitles an existing workspace and rejects mismatched creation metadata', async () => {
    const existing = registry(); existing.resolveByPath.mockResolvedValue(metadata());
    await expect(createOwnedWorkspace(authorized(), paths(), nonce, existing)).rejects.toThrow('fixture-workspace'); expect(existing.create).not.toHaveBeenCalled();
    for (const changed of [{ id: 'invalid' }, { path: '/unowned' }, { title: 'Existing user workspace' }, { sessionIds: ['unowned'] }]) {
      const api = registry(); api.create.mockResolvedValue({ ...metadata(), ...changed });
      await expect(createOwnedWorkspace(authorized(), paths(), nonce, api)).rejects.toThrow('fixture-workspace');
    }
    const malformed = registry();
    await expect(createOwnedWorkspace(authorized(), { ...paths(), repo: '/existing-user-project' }, nonce, malformed)).rejects.toThrow('fixture-workspace');
    expect(malformed.resolveByPath).not.toHaveBeenCalled(); expect(malformed.create).not.toHaveBeenCalled();
  });
  it('uses public workspaceId exclusively with cwd omitted; never seeds a prompt', () => {
    const workspace = { id, path: paths().repo, title: metadata().title };
    const value = fixtureMainSessionRequest(authorized(), workspace, paths(), nonce);
    expect(value).toEqual({ request: { workspaceId: id, agentPreset: 'standard' } });
    expect(value.request).not.toHaveProperty('cwd'); expect(value.request).not.toHaveProperty('prompt');
    expect(() => fixtureMainSessionRequest({ ...authorized(), allowOwnerTest: false }, workspace, paths(), nonce)).toThrow('authorization');
    expect(() => fixtureMainSessionRequest(authorized(), { ...workspace, path: '/unowned' }, paths(), nonce)).toThrow('fixture-workspace');
  });
  it('records only exact owned native Workspace metadata, preserving it rather than purging', () => {
    const workspace = metadata(); const report = safeReport({ ok: false, stage: 'fixture-C', runId: nonce, ids: { workspace: id }, workspace, cleanup: { nativeWorkspaceRetained: true } });
    expect(report.workspace).toEqual({ id, path: workspace.path, title: workspace.title }); expect(report.cleanup.nativeWorkspaceRetained).toBe(true);
    expect(safeReport({ ...report, workspace: { ...workspace, title: 'SYNTHETIC_SECRET' } }).workspace).toBeUndefined();
    expect(safeReport({ ...report, workspace: { ...workspace, path: '/unowned' } }).workspace).toBeUndefined();
  });
});

function nativePreflight(id = 'owned-c') {
  const order: string[] = [];
  const editor = { waitFor: vi.fn(async () => {}), count: vi.fn(async () => 1), isEditable: vi.fn(async () => true), isEnabled: vi.fn(async () => true), fill: vi.fn(async (_: string) => { order.push('fill'); }) };
  const send = { count: vi.fn(async () => 1), isEnabled: vi.fn(async () => true), click: vi.fn(async (options?: { trial?: boolean }) => { order.push(options?.trial ? 'trial' : 'send'); }) };
  const native = { count: vi.fn(async () => 1), getAttribute: vi.fn(async (_: string) => id), locator: vi.fn(() => editor), getByRole: vi.fn(() => send) };
  const budget = { reserve: vi.fn((_: string) => { order.push('reserve'); }) };
  return { native, editor, send, budget, order };
}
describe('real native composer preconditions before any model request', () => {
  it('checks flags before any DOM metadata or draft access', async () => {
    const f = nativePreflight();
    await expect(sendOwnedNative({ ...authorized(), allowModelRequests: false }, f.native, 'owned-c', 'fixture', f.budget, 'initial')).rejects.toThrow('authorization');
    expect(f.native.count).not.toHaveBeenCalled(); expect(f.editor.fill).not.toHaveBeenCalled(); expect(f.budget.reserve).not.toHaveBeenCalled();
  });
  it('refuses wrong or duplicated native session roots before filling or sending', async () => {
    const wrong = nativePreflight('other-session');
    await expect(sendOwnedNative(authorized(), wrong.native, 'owned-c', 'fixture', wrong.budget, 'initial')).rejects.toThrow('native-composer-precondition');
    expect(wrong.native.locator).not.toHaveBeenCalled(); expect(wrong.budget.reserve).not.toHaveBeenCalled();
    const duplicate = nativePreflight(); duplicate.native.count.mockResolvedValue(2);
    await expect(sendOwnedNative(authorized(), duplicate.native, 'owned-c', 'fixture', duplicate.budget, 'initial')).rejects.toThrow('native-composer-precondition');
    expect(duplicate.editor.fill).not.toHaveBeenCalled(); expect(duplicate.budget.reserve).not.toHaveBeenCalled();
  });
  it('does not bypass a disabled or readonly ordinary native hero editor', async () => {
    for (const key of ['isEditable', 'isEnabled'] as const) {
      const f = nativePreflight(); f.editor[key].mockResolvedValue(false);
      await expect(sendOwnedNative(authorized(), f.native, 'owned-c', 'fixture', f.budget, 'initial')).rejects.toThrow('native-composer-precondition');
      expect(f.editor.fill).not.toHaveBeenCalled(); expect(f.send.click).not.toHaveBeenCalled(); expect(f.budget.reserve).not.toHaveBeenCalled();
    }
  });
  it('fails the trial precondition without issuing an actual Send or reserving a model prompt', async () => {
    const f = nativePreflight(); f.send.click.mockRejectedValue(new Error('https://invalid/?token=SYNTHETIC_SECRET'));
    await expect(sendOwnedNative(authorized(), f.native, 'owned-c', 'fixture', f.budget, 'initial')).rejects.toThrow('native-composer-precondition');
    expect(f.send.click).toHaveBeenCalledExactlyOnceWith({ trial: true }); expect(f.budget.reserve).not.toHaveBeenCalled();
  });
  it('reserves only after actual target/editor/Send preconditions, then clicks once without force or retry', async () => {
    const f = nativePreflight();
    expect(await sendOwnedNative(authorized(), f.native, 'owned-c', 'fixture', f.budget, 'initial')).toEqual({ correctScope: true, editorCount: 1, editable: true, sendEnabled: true });
    expect(f.order).toEqual(['fill', 'trial', 'reserve', 'send']);
    expect(f.send.click.mock.calls).toEqual([[{ trial: true }], []]);
    expect(f.budget.reserve).toHaveBeenCalledExactlyOnceWith('initial');
  });
  it('does not repeat an actual Send after uncertain delivery', async () => {
    const f = nativePreflight(); f.send.click.mockImplementation(async options => { if (!options?.trial) throw new Error('uncertain'); });
    await expect(sendOwnedNative(authorized(), f.native, 'owned-c', 'fixture', f.budget, 'initial')).rejects.toThrow('uncertain');
    expect(f.send.click.mock.calls).toEqual([[{ trial: true }], []]); expect(f.budget.reserve).toHaveBeenCalledTimes(1);
  });
});

describe('fixture-only model budget, program, and native tool guard', () => {
  it('caps ordinary prompts at three initial plus three answers without automatic retries', () => {
    const budget = modelBudget(); for (let i = 0; i < 3; i++) { budget.reserve('initial'); budget.reserve('answer'); }
    expect(budget.snapshot()).toEqual({ initial: 3, answer: 3, total: 6 });
    for (const kind of ['initial', 'answer', 'retry', 'unknown']) expect(() => budget.reserve(kind)).toThrow();
  });
  it('permits only exact question calls and the fixed two-page timer program', () => {
    const plan = createPlan('abcdef123456');
    expect(plan.program).toContain('await new Promise(resolve => setTimeout(resolve, 3000))'); expect(plan.program.split('\n')).toHaveLength(4);
    expect((plan.program.match(/tools[.]decision_request/g) ?? []).length).toBe(2);
    expect(plan.program).not.toMatch(/import|node:|fs[.]|bash|fetch/);
    expect(fixtureToolGuard(plan, 'native', { name: 'decision_request', arguments: plan.native[0] })).toBeUndefined();
    expect(fixtureToolGuard(plan, 'ptc', { name: 'run_code', arguments: { code: plan.program } })).toBeUndefined();
    expect(fixtureToolGuard(plan, 'ptc', { name: 'decision_request', arguments: plan.ptc[0] })).toBeUndefined();
    expect(fixtureToolGuard(plan, 'native-ask', { name: 'ask_user_question', arguments: { questions: [{ question: plan.nativeQuestion, options: [{ label: 'Confirmed' }, { label: 'Not confirmed' }] }] } })).toBeUndefined();
    for (const execution of [{ name: 'write', arguments: {} }, { name: 'bash', arguments: {} }, { name: 'run_code', arguments: { code: plan.program + '\nawait import("node:fs");' } }, { name: 'decision_request', arguments: { ...plan.ptc[0], question: 'unowned' } }, { name: 'ask_user_question', arguments: { questions: [{ question: 'unowned', options: [{ label: 'Confirmed' }, { label: 'Not confirmed' }] }] } }]) expect(fixtureToolGuard(plan, 'ptc', execution)).toBeTypeOf('string');
    expect(fixtureToolGuard(plan, 'ack', { name: 'decision_request', arguments: plan.native[0] })).toBeTypeOf('string');
  });
  it('uses the published named request parameter for the read-only question RPC', () => {
    expect(questionRequest('owned-c')).toEqual({ request: { sessionId: 'owned-c' } });
    expect(() => questionRequest('')).toThrow();
  });
  it('uses only the existing GUI host for requests and WebSockets', () => {
    for (const url of ['http://127.0.0.1:51781/', 'http://127.0.0.1:51781/api/kanban/questions', 'ws://127.0.0.1:51781/ws']) expect(requestAllowed(url)).toBe(true);
    for (const url of ['https://outside.invalid/', 'http://127.0.0.1:51782/', 'http://user:secret@127.0.0.1:51781/', 'file:///tmp/private', 'data:text/plain,secret', 'invalid']) expect(requestAllowed(url)).toBe(false);
  });
});

describe('canonical evidence and sanitized output (unit fixtures, not a G4 execution)', () => {
  it('requires actual native tool identity and source/versioned result metadata', () => {
    const events = [call(1, 2, 'call_NATIVE_SECRET'), result(2, 2, 'call_NATIVE_SECRET'), end(3, 2)];
    const pages = correlateQuestionEvidence(events, 'native'); expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ seq: 2, turn: 2, kind: 'kanban.question-page', version: 1, type: 'exclusive', source: 'native' });
    expect(pages[0].callIdHash).toMatch(/^[a-f0-9]{16}$/); expect(JSON.stringify(pages)).not.toContain('NATIVE_SECRET');
    expect(correlateQuestionEvidence(events.slice(1), 'native')).toEqual([]);
    const malformed = result(4, 2, 'call_NATIVE_SECRET'); (malformed.data as any).meta.version = 2;
    expect(correlateQuestionEvidence([events[0], malformed], 'native')).toEqual([]);
  });
  it('correlates PTC only to an actual run_code root, not a guessed turn', () => {
    const page = ptcResult(4, 'root', 'root:ptc:1');
    expect(correlateQuestionEvidence([page], 'ptc')).toEqual([]);
    expect(correlateQuestionEvidence([call(1, 9, 'root', 'run_code'), page], 'ptc')[0]).toMatchObject({ turn: 9, source: 'ptc' });
    expect(correlateQuestionEvidence([call(1, 9, 'root', 'other'), page], 'ptc')).toEqual([]);
    expect(correlateQuestionEvidence([call(1, 9, 'root', 'run_code'), end(2, 9), page], 'ptc')).toEqual([]);
    const failed = { ...page, data: { ...(page.data as object), isError: true } };
    expect(correlateQuestionEvidence([call(1, 9, 'root', 'run_code'), failed], 'ptc')).toEqual([]);
  });
  it('does not expose raw errors, URLs, cookies, state, or model content and never infers a pass', () => {
    const secret = 'https://invalid/?token=SYNTHETIC_SECRET';
    const report = safeReport({ ok: true, stage: secret, authenticatedUrl: secret, rawError: secret, cookies: secret, storageState: secret, ids: { C: secret }, checks: { nativeActualTools: true, hidden: secret }, evidence: { native: [{ seq: 1, turn: 0, callIdHash: secret, page: secret, source: 'native' }] }, dom: { native: { formCount: 1, correctScope: true, rawHTML: secret, cookie: secret } }, modelRequests: { initial: 99, answer: 99, total: 198 } });
    expect(report.ok).toBe(false); expect(report.stage).toBe('arguments'); expect(JSON.stringify(report)).not.toContain('SYNTHETIC_SECRET');
    expect(safeReport(null).ok).toBe(false);
    expect(report.dom).toEqual({ native: { formCount: 1, correctScope: true } });
    expect(report.limitations).toContain('No G4 claim is established by helper unit tests.');
  });
});
