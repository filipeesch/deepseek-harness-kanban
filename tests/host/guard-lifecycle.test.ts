import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearGuardConfigurations, createNativeLifetime, type LifetimeWitness } from '../../src/host/deterministic/lifetime.js';
import { guardArtifact } from '../support/guard-artifact.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kanban-guard-lifecycle-'));
  roots.push(root);
  return root;
}

/** Send one authenticated message and resolve its first authenticated frame. */
function firstMessage(port: number, message: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', text => {
      buffer += text;
      const end = buffer.indexOf('\n');
      if (end === -1) return;
      const frame = buffer.slice(0, end);
      socket.destroy();
      resolve(JSON.parse(frame) as Record<string, unknown>);
    });
    socket.once('error', reject);
    socket.once('close', () => resolve(undefined));
  });
}

describe('private guard configuration', () => {
  it('keeps the authorization and the reviewed source off the command line', async () => {
    const root = await workspace();
    const lifetime = await createNativeLifetime({ register: async () => {}, settled: async () => {}, sweep: async () => {}, directory: join(root, 'private'), guardPath: await guardArtifact() });
    try {
      const command = lifetime.shell('printf reviewed-source');
      const prelude = lifetime.typescriptPrelude();
      // Neither the reviewed source nor the authorization may reach a command line.
      expect(command).not.toContain('reviewed-source');
      expect(prelude).not.toContain('reviewed-source');
      const names = await readdir(join(root, 'private', 'guards'));
      expect(names).toHaveLength(3);
      for (const name of names) {
        const path = join(root, 'private', 'guards', name);
        const contents = await readFile(path, 'utf8');
        expect(command).not.toContain(contents);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        if (!name.endsWith('.json')) { expect(contents).toBe('printf reviewed-source'); continue; }
        const configuration = JSON.parse(contents) as { authorization: string; mode: string };
        expect(command).not.toContain(configuration.authorization);
        expect(prelude).not.toContain(configuration.authorization);
        expect(contents).not.toContain('reviewed-source');
      }
    } finally { await lifetime.close(); }
    expect(await readdir(join(root, 'private', 'guards'))).toEqual([]);
  });

  it('removes a configuration a host that did not finish left behind', async () => {
    const root = await workspace();
    const guards = join(root, 'private', 'guards');
    await mkdir(guards, { recursive: true });
    await writeFile(join(guards, '0123456789abcdef.json'), '{}');
    await writeFile(join(guards, 'notes.txt'), 'keep');
    clearGuardConfigurations(join(root, 'private'));
    expect(await readdir(guards)).toEqual(['notes.txt']);
  });
});

/** Run several messages on one connection and collect the expected reply frames. */
function exchange(port: number, messages: Record<string, unknown>[], expected: number): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    const frames: Record<string, unknown>[] = [];
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('connect', () => { for (const message of messages) socket.write(JSON.stringify(message) + '\n'); });
    socket.on('data', text => {
      buffer += text;
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        frames.push(JSON.parse(buffer.slice(0, end)) as Record<string, unknown>);
        buffer = buffer.slice(end + 1);
        if (frames.length === expected) { socket.destroy(); resolve(frames); return; }
      }
    });
    socket.once('error', error => { if (frames.length === 0) reject(error); });
    socket.once('close', () => resolve(frames));
  });
}

describe('lifetime channel', () => {
  it('accepts a registration only with a signed pid and answers an authentic sweep', async () => {
    const root = await workspace();
    const witnesses: LifetimeWitness[] = [];
    const sweeps: string[] = [];
    const exclusions: number[][] = [];
    const lifetime = await createNativeLifetime({
      register: async witness => { witnesses.push(witness); },
      settled: async () => {},
      sweep: async (marker, exclude) => { sweeps.push(marker); exclusions.push([...exclude]); },
      directory: join(root, 'private'),
    });
    try {
      const sign = (text: string): string => createHmac('sha256', lifetime.host.token).update(text).digest('hex');
      const marker = 'b'.repeat(32);
      const guardToken = 'a'.repeat(64);
      const challenge = 'c'.repeat(64);
      const frames = await exchange(lifetime.host.port, [
        { type: 'register', port: 4100, token: guardToken, marker, pid: 4321, proof: sign('register:4100:' + guardToken + ':' + marker + ':4321') },
        { type: 'sweep', challenge, marker, proof: sign('request:sweep:' + challenge + ':' + marker) },
      ], 2);
      expect(frames[0]).toMatchObject({ type: 'ack' });
      expect(frames[1]).toMatchObject({ type: 'sweep-result', payload: { clean: true } });
      await expect.poll(() => witnesses.length).toBe(1);
      expect(witnesses[0]).toMatchObject({ pid: 4321, marker });
      expect(sweeps).toEqual([marker]);
      // A live guard is excluded from the sweep that proves its own tree.
      expect(exclusions).toEqual([[4321]]);

      const unsigned = await firstMessage(lifetime.host.port, { type: 'register', port: 4101, token: guardToken, marker, proof: 'f'.repeat(64) });
      expect(unsigned).toBeUndefined();
      expect(await firstMessage(lifetime.host.port, { type: 'sweep', challenge, marker, proof: 'e'.repeat(64) })).toBeUndefined();
    } finally { await lifetime.close(); }
  });
});
