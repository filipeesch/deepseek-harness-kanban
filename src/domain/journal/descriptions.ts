import { parseDocument } from 'yaml';

/** Detect authored fields even when parsing normalizes blank descriptions away. */
export function hasAuthoredDescriptions(text: string): boolean {
  try {
    const document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
    const root: unknown = document.toJS({ maxAliasCount: 100 });
    const mapping = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!mapping(root)) return false;
    if (Object.hasOwn(root, 'description')) return true;
    return Array.isArray(root.columns) && root.columns.some(value => mapping(value) && Object.hasOwn(value, 'description'));
  } catch {
    // An unreadable document cannot establish that it is legacy-compatible.
    return true;
  }
}

/** Detect an authored decision block, which needs the decision event format. */
export function hasAuthoredDecision(text: string): boolean {
  try {
    const document = parseDocument(text, { uniqueKeys: true, prettyErrors: false, version: '1.2' });
    const root: unknown = document.toJS({ maxAliasCount: 100 });
    const mapping = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!mapping(root)) return false;
    return Array.isArray(root.columns) && root.columns.some(value => mapping(value) && Object.hasOwn(value, 'decision'));
  } catch {
    // An unreadable document cannot establish that it is legacy-compatible.
    return true;
  }
}
