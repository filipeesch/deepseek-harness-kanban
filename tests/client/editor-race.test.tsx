// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import {userEvent} from '@testing-library/user-event';
import {Configuration, InfoPanel, NotesPanel} from '../../src/client/forms.js';
import type {KanbanSnapshot} from '../../src/shared/types.js';
import {fixture} from './helpers.js';

vi.mock('../../src/client/code-editor.js', async () => {
  const React = await import('react');
  return {
    CodeEditor: ({ value, onChange, label, readOnly }: { value: string; onChange: (value: string) => void; label: string; readOnly?: boolean }) =>
      React.createElement('textarea', { 'aria-label': label, value, disabled: readOnly, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
  };
});

afterEach(cleanup);
function pending() { let resolve!: (value: KanbanSnapshot) => void; let reject!: (error: unknown) => void; const run = vi.fn(() => new Promise<KanbanSnapshot>((done, fail) => {resolve=done;reject=fail;})); return {run, resolve: (value:KanbanSnapshot)=>resolve(value), reject:(error:unknown)=>reject(error)}; }
describe('editor save draft lifetime',()=>{
 it('locks task fields until a save completes and permits the next draft afterward',async()=>{
  const value=fixture(), p=pending(), user=userEvent.setup(); const view=render(<InfoPanel task={value.state.tasks[0]!} state={value.state} run={p.run}/>);
  await user.click(screen.getByRole('button',{name:'Edit'}));
  const title=screen.getByRole('textbox',{name:'Title'}) as HTMLInputElement;
  await user.clear(title);await user.type(title,'FIRST SAVE');await user.click(screen.getByRole('button',{name:'Save task'}));
  expect(title.disabled).toBe(true);expect((screen.getByRole('textbox',{name:'Description'}) as HTMLTextAreaElement).disabled).toBe(true);
  await user.type(title,'UNSAVED DRAFT');expect(title.value).toBe('FIRST SAVE');
  const saved=fixture();saved.state.revision=2;saved.state.tasks[0]!.title='FIRST SAVE';
  await act(async()=>{view.rerender(<InfoPanel task={saved.state.tasks[0]!} state={saved.state} run={p.run}/>);p.resolve(saved);});
  await screen.findByText('Task saved.');await user.click(screen.getByRole('button',{name:'Edit'}));const nextTitle=screen.getByRole('textbox',{name:'Title'}) as HTMLInputElement;await user.clear(nextTitle);await user.type(nextTitle,'NEXT DRAFT');expect(nextTitle.value).toBe('NEXT DRAFT');
 });
 it.each(['success','failure'] as const)('isolates a different task editor from an older save (%s)',async outcome=>{
  const value=fixture(),p=pending(),user=userEvent.setup();const view=render(<InfoPanel task={value.state.tasks[0]!} state={value.state} run={p.run}/>);
  await user.click(screen.getByRole('button',{name:'Edit'}));
  await user.type(screen.getByRole('textbox',{name:'Title'}),' edited');await user.click(screen.getByRole('button',{name:'Save task'}));
  view.rerender(<InfoPanel task={value.state.tasks[1]!} state={value.state} run={p.run}/>);
  await user.click(screen.getByRole('button',{name:'Edit'}));
  expect((screen.getByRole('textbox',{name:'Title'}) as HTMLInputElement).value).toBe('Beta task');
  await user.clear(screen.getByRole('textbox',{name:'Title'}));await user.type(screen.getByRole('textbox',{name:'Title'}),'B DRAFT');
  await act(async()=>{if(outcome==='failure')p.reject({code:'OLD_A_FAILURE',message:'Old editor failure'});else p.resolve(value);});
  expect((screen.getByRole('textbox',{name:'Title'}) as HTMLInputElement).value).toBe('B DRAFT');expect(screen.queryByText('OLD_A_FAILURE')).toBeNull();
 });
 it('locks note selection and content so an old save cannot erase another note draft',async()=>{
  const value=fixture();value.state.notes=['a','b'].map(id=>({id,taskId:'t1',content:'note '+id,createdAt:'now',updatedAt:'now'}));
  const p=pending(),user=userEvent.setup();render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={p.run}/>);
  await user.click(screen.getByRole('button',{name:'Edit note a'}));await user.click(screen.getByRole('button',{name:'Save note'}));
  for(const name of ['New note','Edit note a','Edit note b'])expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);
  const editor=screen.getByRole('textbox',{name:'Edit note Markdown'}) as HTMLTextAreaElement;expect(editor.disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Edit note b'}));await user.type(editor,'UNSAVED B DRAFT');expect(editor.value).toBe('note a');
  await act(async()=>p.resolve(value));await screen.findByText('Note saved for all task conversations.');
  await user.click(screen.getByRole('button',{name:'Edit note b'}));await user.type(screen.getByRole('textbox',{name:'Edit note Markdown'}),' B DRAFT');
  expect((screen.getByRole('textbox',{name:'Edit note Markdown'}) as HTMLTextAreaElement).value).toBe('note b B DRAFT');expect(p.run).toHaveBeenCalledTimes(1);
 });
 it('does not carry a selected note or a late success into another task',async()=>{
  const value=fixture();value.state.notes=[{id:'a',taskId:'t1',content:'note a',createdAt:'now',updatedAt:'now'}];const p=pending(),user=userEvent.setup();
  const view=render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={p.run}/>);await user.click(screen.getByRole('button',{name:'Edit note a'}));await user.click(screen.getByRole('button',{name:'Save note'}));
  view.rerender(<NotesPanel task={value.state.tasks[1]!} state={value.state} run={p.run}/>);
  const editor=screen.getByRole('textbox',{name:'New note Markdown'}) as HTMLTextAreaElement;await user.type(editor,'B NEW NOTE');
  await act(async()=>p.resolve(value));expect(editor.value).toBe('B NEW NOTE');expect(screen.queryByText('Note saved for all task conversations.')).toBeNull();
 });
 it('locks workflow text while its approved version is being saved',async()=>{
  const value=fixture(),p=pending(),user=userEvent.setup();render(<Configuration state={value.state} hub={value.state.hubs[0]!} board={value.state.hubs[0]!.boards[0]!} hubCount={1} settings={value.state.settings} settingsRevision={value.state.settings.revision} run={p.run} onClose={()=>{}} initial="Board"/>);
  const editor=screen.getByRole('textbox',{name:'Workflow YAML'}) as HTMLTextAreaElement;await user.click(screen.getByRole('button',{name:'Save workflow'}));
  expect(editor.disabled).toBe(true);await user.type(editor,'NEW UNSAVED YAML');expect(editor.value).toBe(value.state.workflowYaml);
  await act(async()=>p.resolve(value));await waitFor(()=>expect(editor.disabled).toBe(false));
 });
 it('unlocks a failed note save without changing its selected note or Markdown draft',async()=>{
  const value=fixture();value.state.notes=[{id:'a',taskId:'t1',content:'note a',createdAt:'now',updatedAt:'now'}];const p=pending(),user=userEvent.setup();render(<NotesPanel task={value.state.tasks[0]!} state={value.state} run={p.run}/>);
  await user.click(screen.getByRole('button',{name:'Edit note a'}));const editor=screen.getByRole('textbox',{name:'Edit note Markdown'}) as HTMLTextAreaElement;await user.type(editor,' draft');await user.click(screen.getByRole('button',{name:'Save note'}));
  await act(async()=>p.reject({code:'SAVE_FAILED',message:'Retry this draft.'}));await screen.findByText('SAVE_FAILED');expect(editor.value).toBe('note a draft');expect(editor.disabled).toBe(false);expect((screen.getByRole('button',{name:'New note'}) as HTMLButtonElement).disabled).toBe(false);
 });
});
