import { describe, expect, it } from 'vitest';
import { productToolDefinitions } from '../../src/host/tools/index.js';
import { PRODUCT_TOOL_NAMES } from '../../src/host/tools/names.js';
import type { PlanFilePort } from '../../src/shared/ports.js';

function stub<T>(): T {
  return new Proxy({}, { get: () => () => undefined }) as T;
}

/** The plan tools are declared whenever the composition binds their port, so the contract composes it. */
const plans: PlanFilePort = { write: stub(), patch: stub() };

describe('the product tool name list', () => {
  it('names exactly the tools the plugin registers', () => {
    const definitions = productToolDefinitions(stub(), stub(), stub(), { plans });
    expect(definitions.map(definition => definition.name).sort()).toEqual([...PRODUCT_TOOL_NAMES].sort());
  });

  it('names no duplicate', () => {
    expect(new Set(PRODUCT_TOOL_NAMES).size).toBe(PRODUCT_TOOL_NAMES.length);
  });

  it('declares neither plan tool when the composition binds no port', () => {
    const definitions = productToolDefinitions(stub(), stub(), stub(), {});
    const names = definitions.map(definition => definition.name);
    expect(names).not.toContain('write_plan');
    expect(names).not.toContain('patch_plan');
  });
});
