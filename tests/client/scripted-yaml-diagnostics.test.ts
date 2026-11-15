import { describe, expect, it } from 'vitest';
import { analyzeWorkflow } from '../../src/client/workflow-diagnostics.js';
const document = (definition: string, extra = '') => ['name: CI', 'columns:', '  - id: wait', '    label: Wait', extra, '    scripted:', ...definition.split('\n').map(line => '      ' + line), '  - id: done', '    label: Done', ''].filter(Boolean).join('\n');
describe('targeted scripted YAML diagnostics', () => {
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
    expect(result.issues[0]?.message).toContain('sole scripted routing');
    expect(yaml.slice(result.diagnostics[0]!.from, result.diagnostics[0]!.to)).toContain('done');
  });
  it('pins an invalid parameter declaration to its authored scalar', () => {
    const yaml = document('language: bash\ncode: echo ok\nparams:\n    - name: bad name\nexits: {ok: done}');
    const result = analyzeWorkflow(yaml);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics[0]!.from).toBeGreaterThan(0);
    expect(yaml.slice(result.diagnostics[0]!.from, result.diagnostics[0]!.to)).toContain('bad name');
  });
  it('reads a stage authored with the legacy key and still pins its problems', () => {
    const invalid = document('language: bash\ncode: echo ok\nenv: [BAD=VALUE]\nexits: {ok: done}').replace('    scripted:', '    deterministic:');
    const result = analyzeWorkflow(invalid);
    expect(result.status).toBe('invalid');
    expect(invalid.slice(result.diagnostics[0]!.from, result.diagnostics[0]!.to)).toContain('BAD=VALUE');
    const valid = document('language: bash\ncode: echo ok\nexits: {ok: done}').replace('    scripted:', '    deterministic:');
    expect(analyzeWorkflow(valid).status).toBe('valid');
  });
  it('rejects a self route and accepts distinct exits sharing a target', () => {
    expect(analyzeWorkflow(document('language: bash\ncode: echo ok\nexits: {ok: wait}')).issues[0]?.message).toContain('another existing stage');
    expect(analyzeWorkflow(document('language: bash\ncode: echo ok\nexits: {ok: done, cached: done}')).status).toBe('valid');
  });
});