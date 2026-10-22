import {afterEach, describe, expect, it, vi} from 'vitest';
// @ts-expect-error The standalone Node-native CLI intentionally has no TypeScript build dependency.
import {CdpClient, callHost, connectInspector, parseArgs, projectSemanticTree, projectSources, runCommand, validateBuiltPackage, validateEndpoint} from '../../scripts/dsh-inspect.mjs';

afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

class FakeSocket extends EventTarget {
  readyState = 1;
  frames: Array<{id: number; method: string; params: unknown}> = [];
  send(frame: string) {this.frames.push(JSON.parse(frame));}
  close() {this.readyState = 3; this.dispatchEvent(new Event('close'));}
  receive(value: unknown) {this.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(value)}));}
}

const root = {nodeId: 1, localName: '', nodeName: '#document', childNodeCount: 1, children: [
  {nodeId: 2, localName: 'host', childNodeCount: 1, children: [{nodeId: 3, localName: 'context', childNodeCount: 0, children: []}]},
]};
function fakeClient(sources: unknown[] = [], contexts: unknown[] = []) {
  return {
    contexts: new Map(contexts.map((context: any) => [context.id, context])),
    close: vi.fn(async () => {}),
    call: vi.fn(async (method: string, params: any = {}): Promise<any> => {
      if (method === 'DSHInspector.getSources') return {sources};
      if (method === 'DOM.getDocument') return {root};
      if (method === 'DOM.resolveNode') return {object: {objectId: 'host-object'}};
      if (method === 'Runtime.callFunctionOn') return {result: {value: {safe: true}}};
      return {};
    }),
  };
}
function packageFixture(overrides: Record<string, unknown> = {}) {
  const manifest = {
    name: 'dsh-test', version: '0.1.0',
    exports: {'.': {default: './lib/index.js'}, './client': './lib/client.js'},
    dsh: {bundle: {patch: './cordis.patch.yml'}, client: {platform: 'web'}},
    ...overrides,
  };
  return {
    realpath: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => ({isFile: () => true})),
    readFile: vi.fn(async (path: string) => path.endsWith('/package.json') ? JSON.stringify(manifest)
      : 'window.__ModuleLoader__.load({id:"dsh-test",factory(){return {apply(){}}}});'),
  };
}

describe('explicit safe CLI surface', () => {
  it('defaults to read-only inventory on the existing local inspector', () => {
    expect(parseArgs([])).toMatchObject({command: 'inventory', endpoint: 'http://127.0.0.1:9230', allowMutation: false});
  });
  it.each([
    ['install'], ['enable', '--path', '/trusted/plugin'], ['install', '--allow-mutation', '--path', './plugin'],
    ['inventory', '--allow-mutation'], ['clients', '--path', '/trusted/plugin'],
    ['inventory', '--eval', 'process.env'], ['snapshot', '--depth', '999'],
    ['clients', '--timeout-ms', 'Infinity'], ['clients', '--client', 'x'],
  ])('rejects unsupported or insufficiently guarded arguments %j', (...args) => {
    expect(() => parseArgs(args)).toThrow();
  });
  it('requires both confirmation and absolute built package path for each mutation', () => {
    expect(parseArgs(['install', '--allow-mutation', '--path', '/trusted/plugin'])).toMatchObject({allowMutation: true, packagePath: '/trusted/plugin'});
  });
  it.each(['https://127.0.0.1:9230', 'http://example.com:9230', 'http://user:secret@127.0.0.1:9230', 'http://127.0.0.1:9230/?token=x', 'http://127.0.0.1:9230/json'])('rejects nonlocal/auth/path endpoint %s', endpoint => {
    expect(() => validateEndpoint(endpoint)).toThrow();
  });
  it('rechecks mutation guard before network access when used as a module', async () => {
    const connect = vi.fn();
    await expect(runCommand({command: 'install', packagePath: '/trusted/plugin'}, {connect})).rejects.toThrow('explicit confirmation');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('built package guard', () => {
  it('accepts exact-name lazy client registration and returns a link spec', async () => {
    await expect(validateBuiltPackage('/trusted/plugin', packageFixture())).resolves.toEqual({root: '/trusted/plugin', name: 'dsh-test', version: '0.1.0', spec: 'link:/trusted/plugin'});
  });
  it('refuses a package declaring only a client half', async () => {
    await expect(validateBuiltPackage('/trusted/plugin', packageFixture({dsh: {client: {platform: 'web'}}}))).rejects.toThrow('bundle.patch');
  });
  it('refuses missing/escaping built exports and unbuilt raw ESM', async () => {
    const escaping = packageFixture();
    escaping.realpath.mockImplementation(async (path: string) => path.endsWith('/lib/client.js') ? '/elsewhere/client.js' : path);
    await expect(validateBuiltPackage('/trusted/plugin', escaping)).rejects.toThrow('within the package');
    const raw = packageFixture();
    raw.readFile.mockImplementation(async (path: string) => path.endsWith('/package.json') ? JSON.stringify({name: 'dsh-test', exports: {'.': './lib/index.js', './client': './lib/client.js'}, dsh: {client: {platform: 'web'}, bundle: {patch: './cordis.patch.yml'}}}) : 'export function apply(){}');
    await expect(validateBuiltPackage('/trusted/plugin', raw)).rejects.toThrow('register its exact name');
  });
  it('validates artifacts before connecting for an explicit mutation', async () => {
    const connect = vi.fn();
    const validatePackage = vi.fn(async () => {throw new Error('not built');});
    await expect(runCommand(parseArgs(['enable', '--path', '/trusted/plugin', '--allow-mutation']), {connect, validatePackage})).rejects.toThrow('not built');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('native CDP transport bounds and cleanup', () => {
  it('correlates out-of-order replies and tracks only active contexts', async () => {
    const socket = new FakeSocket(), client = new CdpClient(socket);
    const first = client.call('one'), second = client.call('two');
    socket.receive({method: 'Runtime.executionContextCreated', params: {context: {id: -1, auxData: {sourceId: 'client'}}}});
    socket.receive({id: 2, result: {two: true}}); socket.receive({id: 1, result: {one: true}});
    await expect(first).resolves.toEqual({one: true}); await expect(second).resolves.toEqual({two: true});
    expect(client.contexts.size).toBe(1);
    socket.receive({method: 'Runtime.executionContextDestroyed', params: {executionContextId: -1}});
    expect(client.contexts.size).toBe(0);
    await client.close(); expect(socket.readyState).toBe(3); expect(client.pending.size).toBe(0);
  });
  it('rejects a timed-out call and removes its timer/pending request', async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket(), client = new CdpClient(socket, 100);
    const result = expect(client.call('never')).rejects.toThrow('STILL be running');
    await vi.advanceTimersByTimeAsync(100); await result;
    expect(client.pending.size).toBe(0); await client.close(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects pending calls on close and cleans up', async () => {
    const socket = new FakeSocket(), client = new CdpClient(socket);
    const result = expect(client.call('pending')).rejects.toThrow('disposed');
    await client.close(); await result;
    await expect(client.call('after')).rejects.toThrow('not open');
  });
  it('surfaces protocol errors and malformed frames without hanging', async () => {
    const socket = new FakeSocket(), client = new CdpClient(socket);
    const error = expect(client.call('bad')).rejects.toThrow('denied');
    socket.receive({id: 1, error: {message: 'denied'}}); await error;
    const malformed = expect(client.call('pending')).rejects.toThrow();
    socket.dispatchEvent(new MessageEvent('message', {data: 'not JSON'})); await malformed;
    await client.close(); expect(socket.readyState).toBe(3);
  });
  it('bounds connection establishment and closes a stalled socket', async () => {
    vi.useFakeTimers();
    let opened: FakeSocket | undefined;
    class StalledSocket extends FakeSocket {constructor() {super(); this.readyState = 0; opened = this;}}
    const result = expect(CdpClient.connect('ws://127.0.0.1:9230/devtools/page/x', {timeoutMs: 100, WebSocketImpl: StalledSocket})).rejects.toThrow('connect timeout');
    await vi.advanceTimersByTimeAsync(100); await result;
    expect(opened?.readyState).toBe(3); expect(vi.getTimerCount()).toBe(0);
  });
  it('refuses unexpected discovered hosts before opening a socket', async () => {
    const fetchImpl = vi.fn(async () => ({ok: true, text: async () => JSON.stringify([{url: 'dsh://host', type: 'page', webSocketDebuggerUrl: 'ws://elsewhere.invalid:9230/devtools/page/x'}])}));
    const connect = vi.spyOn(CdpClient, 'connect');
    await expect(connectInspector(parseArgs([]), {fetchImpl})).rejects.toThrow('nonlocal');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('supported object resolution and safe projections', () => {
  it('resolves the published Host semantic Context and releases objects', async () => {
    const client = fakeClient();
    await expect(callHost(client, 'function(){return {safe:true}}')).resolves.toEqual({safe: true});
    expect(client.call).toHaveBeenCalledWith('DOM.resolveNode', expect.objectContaining({nodeId: 3}));
    expect(client.call).toHaveBeenLastCalledWith('Runtime.releaseObjectGroup', expect.anything());
  });
  it('releases Host objects even when evaluation throws', async () => {
    const client = fakeClient();
    client.call.mockImplementation(async (method: string) => {
      if (method === 'DOM.getDocument') return {root};
      if (method === 'DOM.resolveNode') return {object: {objectId: 'host-object'}};
      if (method === 'Runtime.callFunctionOn') return {exceptionDetails: {text: 'Uncaught'}};
      return {};
    });
    await expect(callHost(client, 'function(){}')).rejects.toThrow('Uncaught');
    expect(client.call).toHaveBeenLastCalledWith('Runtime.releaseObjectGroup', expect.anything());
  });
  it('marks depth/node truncation and removes arbitrary semantic attributes', () => {
    const tree = projectSemanticTree({localName: 'context', childNodeCount: 10, attributes: ['uid', '1', 'token', 'secret'], children: []}, 1);
    expect(tree).toMatchObject({returnedNodes: 1, truncated: true, root: {attributes: {uid: '1'}}});
    expect(JSON.stringify(tree)).not.toContain('secret');
  });
  it('projects source metadata without observation payloads or URL secrets', () => {
    const rows = projectSources([{sourceId: 'c', kind: 'client', label: 'Client', topics: {secret: 'token'}, url: '?token=x'}], [{id: -1, auxData: {sourceId: 'c'}}]);
    expect(rows[0]).toMatchObject({contextId: -1, runtimeAvailable: true});
    expect(JSON.stringify(rows)).not.toContain('token');
  });
  it('returns an explicit live-GUI limitation when no Client realm is connected', async () => {
    const client = fakeClient();
    const result = await runCommand(parseArgs(['snapshot']), {connect: async () => client});
    expect(result.page).toBeNull(); expect(result.limitation).toContain('No connected Client'); expect(client.close).toHaveBeenCalledOnce();
  });
  it('does not pick an arbitrary page when multiple Client realms are active', async () => {
    const sources = ['a', 'b'].map(sourceId => ({sourceId, kind: 'client', label: sourceId}));
    const contexts = ['a', 'b'].map((sourceId, i) => ({id: -i - 1, auxData: {sourceId}}));
    const client = fakeClient(sources, contexts);
    await expect(runCommand(parseArgs(['snapshot']), {connect: async () => client})).rejects.toThrow('Multiple Clients');
    expect(client.close).toHaveBeenCalledOnce();
  });
  it('routes page structure to the Client context and never reads text/input values', async () => {
    const client = fakeClient([{sourceId: 'c', kind: 'client', label: 'Client'}], [{id: -5, auxData: {sourceId: 'c'}}]);
    const result = await runCommand(parseArgs(['snapshot', '--client', 'c']), {connect: async () => client});
    expect(result.client.contextId).toBe(-5);
    const call = client.call.mock.calls.find(([method]) => method === 'Runtime.callFunctionOn');
    expect(call?.[1]).toMatchObject({executionContextId: -5});
    const params = call?.[1];
    const element = {tagName: 'INPUT', children: [], getAttribute: (key: string) => key === 'data-testid' ? 'kanban-input' : null,
      get value() {throw new Error('Do not read input value');}, get textContent() {throw new Error('Do not read user text');}};
    const page = new Function('document', 'return (' + params.functionDeclaration + ')(6,300)')({readyState: 'complete', body: element});
    expect(page.root).toEqual({tag: 'input', 'data-testid': 'kanban-input', children: []});
    expect(client.close).toHaveBeenCalledOnce();
  });
  it('executes only public guarded mutation methods in an IN-MEMORY test double', async () => {
    const client = fakeClient();
    let declaration = '';
    client.call.mockImplementation(async (method: string, params: any = {}) => {
      if (method === 'DOM.getDocument') return {root};
      if (method === 'DOM.resolveNode') return {object: {objectId: 'host-object'}};
      if (method === 'Runtime.callFunctionOn') {declaration = params.functionDeclaration; return {result: {value: {application: 'applied'}}};}
      return {};
    });
    await runCommand(parseArgs(['install', '--path', '/trusted/plugin', '--allow-mutation']), {connect: async () => client, validatePackage: async () => ({name: 'dsh-test', spec: 'link:/trusted/plugin'})});
    const manager = {installBundle: vi.fn(async () => ({changed: true, application: 'applied', packageResult: {exitCode: 0, output: 'secret log'}})), setBundleEnabled: vi.fn()};
    const fn = new Function('return (' + declaration + ')')();
    const output = await fn.call({get: () => manager}, 'install', {name: 'dsh-test', spec: 'link:/trusted/plugin'}, 'request');
    expect(manager.installBundle).toHaveBeenCalledWith('link:/trusted/plugin', {enabled: false, requestId: 'request'});
    expect(manager.setBundleEnabled).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toContain('secret log');
  });
});
