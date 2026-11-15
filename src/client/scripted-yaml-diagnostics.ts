import { isMap, isSeq, type Document, type Node } from 'yaml';
import { scriptedDefinitionSchema } from '../domain/scripted-definition.js';
import type { WorkflowIssue } from './workflow-diagnostics.js';

/** Pin schema issues to authored nodes; never serialize YAML just to locate a field. */
export function scriptedYamlIssues(document: Document): WorkflowIssue[] {
  const columns = document.get('columns', true);
  if (!isSeq(columns)) return [];
  const ids = new Set(columns.items.flatMap(column => isMap(column) && typeof column.get('id') === 'string' ? [column.get('id') as string] : []));
  const issues: WorkflowIssue[] = [];
  for (const column of columns.items) {
    if (!isMap(column)) continue;
    // A workflow written before the rename authors the legacy spelling; both are read.
    const key = column.has('scripted') ? 'scripted' : column.has('deterministic') ? 'deterministic' : undefined;
    if (key === undefined) continue;
    const node = column.get(key, true) as Node | undefined;
    const id = column.get('id');
    const add = (message: string, selected: unknown = node) => {
      const range = (selected as { range?: readonly number[] } | null)?.range ?? node?.range;
      issues.push({ code: 'INVALID_WORKFLOW', message: 'Stage ' + String(id) + ': ' + message, ...(range ? { from: range[0], to: range[1] } : {}) });
    };
    const parsed = scriptedDefinitionSchema.safeParse(node?.toJSON());
    if (!parsed.success) {
      for (const issue of parsed.error.issues) add(issue.path.join('.') + ': ' + issue.message, isMap(node) ? node.getIn(issue.path as (string | number)[], true) : node);
      continue;
    }
    if (String(column.get('on_enter_prompt') ?? '').trim()) add('Scripted execution cannot coexist with an agent instruction.', column.get('on_enter_prompt', true));
    if (column.has('allowed_transitions')) add('Named exits are the sole scripted routing definition.', column.get('allowed_transitions', true));
    for (const [exit, target] of Object.entries(parsed.data.exits)) {
      if (target === id || !ids.has(target)) add('Exit ' + exit + ' must target another existing stage.', isMap(node) ? node.getIn(['exits', exit], true) : node);
    }
  }
  return issues;
}