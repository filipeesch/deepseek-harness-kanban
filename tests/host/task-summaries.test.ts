import { describe, expect, it } from 'vitest';
import { HubRepository } from '../../src/host/hub-repository.js';
import { MemoryHubStorage } from './helpers.js';

async function fixture() {
  const hubs = await HubRepository.open(new MemoryHubStorage());
  const first = hubs.defaultHub();
  const firstProject = await first.saveProject({ name: 'First', projectPath: '/memory/first' });
  const firstTask = await first.createTask({ projectId: firstProject.id, title: 'First task', description: '' });
  await first.addSession(firstTask.id, 'session-first');
  await first.setAutoMode(firstTask.id, true);
  const secondHub = await hubs.createHub('Second Hub');
  const second = hubs.hub(secondHub.id);
  const secondBoard = await second.addBoard('Delivery');
  const secondProject = await second.saveProject({ name: 'Second', projectPath: '/memory/second' });
  const secondTask = await second.createTask({ projectId: secondProject.id, boardId: secondBoard.id, title: 'Second task', description: '' });
  await second.addSession(secondTask.id, 'session-second');
  await second.addSession(secondTask.id, 'session-second-closed');
  await second.closeSession(secondTask.id, 'session-second-closed');
  return { hubs, firstTask, secondTask, firstHubId: hubs.defaultHubId(), secondHubId: secondHub.id };
}

describe('task summaries', () => {
  it('projects every Hub without cloning the owning Hub per task', async () => {
    const f = await fixture();
    const summaries = f.hubs.taskSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries.find(summary => summary.taskId === f.firstTask.id)).toMatchObject({
      hubId: f.firstHubId,
      projectId: expect.any(String),
      sessionIds: ['session-first'],
      autoModeEnabled: true,
      hasOperation: false,
      hasPendingTransition: false,
    });
    expect(summaries.find(summary => summary.taskId === f.secondTask.id)).toMatchObject({
      hubId: f.secondHubId,
      sessionIds: ['session-second', 'session-second-closed'],
      closedSessionIds: ['session-second-closed'],
      autoModeEnabled: false,
    });
  });

  it('reuses the projection until the repository changes', async () => {
    const f = await fixture();
    const first = f.hubs.taskSummaries();
    expect(f.hubs.taskSummaries()).toBe(first);
    await f.hubs.defaultHub().setAutoMode(f.firstTask.id, false);
    const second = f.hubs.taskSummaries();
    expect(second).not.toBe(first);
    expect(second.find(summary => summary.taskId === f.firstTask.id)?.autoModeEnabled).toBe(false);
  });
});
