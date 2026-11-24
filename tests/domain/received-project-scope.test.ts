import { describe, expect, it } from 'vitest';
import type { Project } from '../../src/shared/types.js';
import { planReceivedScope } from '../../src/domain/received-project-scope.js';

const registered: Project = { id: 'api', name: 'API', projectKey: 'api', projectPath: '/repo/api' };
const linked: Project = { id: 'mgmt', name: 'Management', projectKey: 'mgmt-local', publishedKey: 'management', projectPath: '/repo/management' };
const placeholder: Project = { id: 'ops', name: 'Ops', projectKey: 'ops', origin: 'published' };
const ignored: Project = { id: 'old', name: 'Old', projectKey: 'old', origin: 'published', dismissed: true };

describe('received project scope', () => {
  it('answers every identity the Hub already holds', () => {
    expect(planReceivedScope(['api', 'management', 'ops'], [registered, linked, placeholder])).toEqual({
      identities: ['api', 'management', 'ops'], placeholders: [], awaiting: ['ops'], ignored: [],
    });
  });

  it('materializes an identity the Hub holds no project for', () => {
    const plan = planReceivedScope(['api', 'gone'], [registered]);
    expect(plan.placeholders).toEqual(['gone']);
    expect(plan.awaiting).toEqual(['gone']);
    expect(plan.identities).toEqual(['api', 'gone']);
  });

  it('presents a placeholder as awaiting adoption', () => {
    const plan = planReceivedScope(['ops'], [placeholder]);
    expect(plan.placeholders).toEqual([]);
    expect(plan.awaiting).toEqual(['ops']);
  });

  it('keeps an ignored identity out of the adoption list', () => {
    const plan = planReceivedScope(['old', 'ops'], [ignored, placeholder]);
    expect(plan.awaiting).toEqual(['ops']);
    expect(plan.ignored).toEqual(['old']);
    expect(plan.identities).toEqual(['old', 'ops']);
  });

  it('treats an absent scope as needing no project', () => {
    expect(planReceivedScope(null, [])).toEqual({ identities: null, placeholders: [], awaiting: [], ignored: [] });
    expect(planReceivedScope([], [])).toEqual({ identities: [], placeholders: [], awaiting: [], ignored: [] });
  });

  it('resolves an identity to one project by its published key', () => {
    const plan = planReceivedScope(['management'], [registered, linked]);
    expect(plan.placeholders).toEqual([]);
    expect(plan.awaiting).toEqual([]);
  });
});
