import { describe, expect, it } from 'vitest';
import { productToolDefinitions } from '../../src/host/tools/index.js';
import { PRODUCT_TOOL_NAMES } from '../../src/host/tools/names.js';

function stub<T>(): T {
  return new Proxy({}, { get: () => () => undefined }) as T;
}

describe('the product tool name list', () => {
  it('names exactly the tools the plugin registers', () => {
    const definitions = productToolDefinitions(stub(), stub(), stub(), {});
    expect(definitions.map(definition => definition.name).sort()).toEqual([...PRODUCT_TOOL_NAMES].sort());
  });

  it('names no duplicate', () => {
    expect(new Set(PRODUCT_TOOL_NAMES).size).toBe(PRODUCT_TOOL_NAMES.length);
  });
});
