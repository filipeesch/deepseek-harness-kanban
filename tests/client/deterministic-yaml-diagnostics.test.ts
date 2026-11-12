import { describe, expect, it } from 'vitest';
import { analyzeWorkflow } from '../../src/client/workflow-diagnostics.js';
const document = (definition: string, extra = '') => ['name: CI', 'columns:', '  - id: wait', '    label: Wait', extra, '    deterministic:', ...definition.split('\n').map(line => '      ' + line), '  - id: done', '    label: Done', ''].filter(Boolean).join('\n');
describe('targeted deterministic YAML diagnostics', () => {
  it('pins invalid variable names to their authored scalar rather than document start', () => {
    const yaml = document('language: bash\ncode: echo ok\nenv: [BAD=VALUE]\nexits: {ok: done}');
    const result = analyzeWorkflow(yaml);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics[0]!.from).toBeGreaterThan(0);
    expect(yaml.slice(result.diagnostics[0]!.from, result.diagnostics[0]!.to)).toContain('BAD=VALUE');
  });
  it('rejects dual routing with a diagnostic on allowed_transitions', () => {
    const yaml = document('language: bash\ncode: echo ok\nexits: {ok: done}', '    allowed_transitions: [done]');
    const result = analyzeWorkflow(yaml);
    expect(result.issues[0]?.message).toContain('sole deterministic routing');
    expect(yaml.slice(result.diagnostics[0]!.from, result.diagnostics[0]!.to)).toContain('done');
  });
  it('rejects a self route and accepts distinct exits sharing a target', () => {
    expect(analyzeWorkflow(document('language: bash\ncode: echo ok\nexits: {ok: wait}')).issues[0]?.message).toContain('another existing stage');
    expect(analyzeWorkflow(document('language: bash\ncode: echo ok\nexits: {ok: done, cached: done}')).status).toBe('valid');
  });
});
