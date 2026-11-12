import { createHash } from 'node:crypto';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import type { CredentialStore } from '../sharing/credentials.js';
import type { DeterministicScope, DeterministicVariables } from './ports.js';
import { failure } from './ports.js';
import { validateVariableName } from './safety.js';

export function scopeKey(scope: DeterministicScope): string {
  if (![scope.hubId, scope.boardId, scope.projectId, scope.stageIdentity].every(value => typeof value === 'string' && value.length > 0)) failure('INVALID_SCOPE', 'A local Hub, project, and stable stage identity are required.');
  return createHash('sha256').update(JSON.stringify([scope.hubId, scope.boardId, scope.projectId, scope.stageIdentity])).digest('hex');
}
/** Owner records do not resolve ambient credential-reference fallbacks. */
export function createDeterministicVariables(source: CredentialStore | undefined | (() => CredentialStore | undefined)): DeterministicVariables {
  const provider = () => {
    const store = typeof source === 'function' ? source() : source;
    if (!store || !(['readRecord', 'describeRecord', 'modifyRecord', 'deleteRecord'] as const).every(name => typeof store[name] === 'function')) failure('CREDENTIALS_UNAVAILABLE', 'Configure a complete native credential provider before using execution variables.');
    return store;
  };
  const key = (scope: DeterministicScope, name: string) => {
    validateVariableName(name);
    return credentialKey('kanban', 'deterministic-' + createHash('sha256').update(scopeKey(scope) + ':' + name).digest('hex'));
  };
  return {
    async status(scope, names) {
      return Promise.all(names.map(async name => ({ name, configured: (await provider().describeRecord(key(scope, name))).configured })));
    },
    async set(scope, name, value) {
      if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value) > 64 * 1024) failure('INVALID_VARIABLE', 'Provide a nonempty value without NUL bytes, at most 64 KiB.');
      await provider().modifyRecord(key(scope, name), async () => ({ kind: 'api-key', key: value }));
    },
    async remove(scope, name) { await provider().deleteRecord(key(scope, name)); },
    async resolve(scope, names) {
      const values: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const name of names) {
        const record = await provider().readRecord(key(scope, name));
        if (record?.kind !== 'api-key' || !record.key || record.key.includes('\0') || Buffer.byteLength(record.key) > 64 * 1024) failure('VARIABLE_MISSING', 'Configure the required local execution variable ' + name + ' for this project and stage.');
        values[name] = record.key;
      }
      return Object.freeze(values);
    },
  };
}
