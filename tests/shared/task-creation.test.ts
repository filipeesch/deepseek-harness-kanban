import { describe, expect, it } from 'vitest';
import { newTaskSchema } from '../../src/shared/task-creation.js';

describe('newTaskSchema', () => {
  it('accepts the documented creation fields', () => {
    expect(newTaskSchema.parse({ projectId: 'p', title: 'T', description: '' })).toEqual({ projectId: 'p', title: 'T', description: '' });
    expect(newTaskSchema.parse({ projectId: 'p', title: 'T', description: '', boardId: 'b', autoMode: true }))
      .toMatchObject({ boardId: 'b', autoMode: true });
  });

  it('rejects unknown fields, an empty title, and a non-boolean auto mode', () => {
    expect(() => newTaskSchema.parse({ projectId: 'p', title: 'T', description: '', extra: true })).toThrow();
    expect(() => newTaskSchema.parse({ projectId: 'p', title: '', description: '' })).toThrow();
    expect(() => newTaskSchema.parse({ projectId: 'p', title: 'T', description: '', autoMode: 'yes' })).toThrow();
  });
});
