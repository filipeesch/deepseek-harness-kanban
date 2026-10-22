import { KanbanError } from '../shared/errors.js';

export const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const reservedIds = new Set(['__proto__', 'prototype', 'constructor']);

export function isDomainId(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_ID_PATTERN.test(value) && !reservedIds.has(value);
}

export function isAbsolutePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.includes(String.fromCharCode(0))) return false;
  if (value.startsWith('/')) return true;
  const separator = String.fromCharCode(92);
  if (value.startsWith(separator + separator)) return true;
  return /^[A-Za-z]$/.test(value[0] ?? '') && value[1] === ':' && (value[2] === '/' || value[2] === separator);
}

export function assertId(value: unknown, label: string): asserts value is string {
  if (!isDomainId(value)) throw new KanbanError('INVALID_ID', label + ' must be a nonempty safe identifier.');
}

export function assertRevision(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new KanbanError('INVALID_REVISION', 'Revision must be a nonnegative safe integer.');
  }
}
