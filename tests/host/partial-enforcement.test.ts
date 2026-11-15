import { describe, expect, it } from 'vitest';
import { partialEnforcementAdvice } from '../../src/host/scripted/native-policy.js';

describe('partial enforcement diagnostics', () => {
  it('names the Windows limitation instead of a generic policy failure', () => {
    expect(partialEnforcementAdvice('win32')).toContain('Windows');
    expect(partialEnforcementAdvice('win32')).toContain('partial file enforcement');
  });

  it('keeps the generic advice on every other platform', () => {
    expect(partialEnforcementAdvice('darwin')).toBe('');
    expect(partialEnforcementAdvice('linux')).toBe('');
  });
});
