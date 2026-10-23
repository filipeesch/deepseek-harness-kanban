// @vitest-environment jsdom
import React from 'react';
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render, screen, waitFor, within} from '@testing-library/react';
import {userEvent} from '@testing-library/user-event';
import {BoardView} from '../../src/client/board.js';
import {fakeApi} from './helpers.js';
afterEach(cleanup);
describe('destructive consent applies to both lifecycle commands',()=>{
 for(const type of ['task.delete','worktree.remove'] as const){
  it.each(['accept','decline'] as const)(type+' requires an independent discard choice (%s)',async choice=>{
   const mock=fakeApi(),user=userEvent.setup();render(<BoardView api={mock.api} renderConversation={id=><span>{id}</span>}/>);
   await user.click(await screen.findByRole('button',{name:'Open task Beta task'}));
   mock.command.mockRejectedValueOnce({code:'DISCARD_REQUIRED',message:'Local changes exist.',details:{path:'/trees/beta'}});
   if(type==='worktree.remove'){await user.click(screen.getByRole('tab',{name:'Git'}));await user.click(screen.getByRole('button',{name:'Remove worktree'}));await user.click(screen.getByRole('button',{name:'Confirm worktree removal'}));}
   else {await user.click(screen.getByRole('button',{name:'Delete task'}));const deleteDialog=await screen.findByRole('dialog',{name:'Delete task'});await user.click(within(deleteDialog).getByRole('button',{name:'Delete task'}));}
   const dialog=await screen.findByRole('dialog',{name:'Discard local worktree changes?'});
   expect(mock.command).toHaveBeenCalledTimes(1);expect(mock.command.mock.calls[0]![0]).toEqual({type,taskId:'t2',confirmed:true,expectedWorktreePath:'/trees/beta'});
   if(choice==='decline'){await user.click(within(dialog).getByRole('button',{name:'Keep local changes'}));expect(mock.command).toHaveBeenCalledTimes(1);expect(mock.get().state.tasks.find(t=>t.id==='t2')?.worktree?.path).toBe('/trees/beta');}
   else {const discard=within(dialog).getByRole('button',{name:'Discard changes and continue'}) as HTMLButtonElement;expect(discard.disabled).toBe(true);await user.click(within(dialog).getByRole('checkbox'));await user.click(discard);await waitFor(()=>expect(mock.command).toHaveBeenCalledTimes(2));expect(mock.command.mock.calls[1]![0]).toEqual({type,taskId:'t2',confirmed:true,expectedWorktreePath:'/trees/beta',discardChanges:true});}
  });
 }
 it('offers no worktree-removal action for a task without a bound worktree',async()=>{
  const mock=fakeApi(),user=userEvent.setup();render(<BoardView api={mock.api} renderConversation={id=><span>{id}</span>}/>);await user.click(await screen.findByRole('button',{name:'Open task Alpha task'}));await user.click(screen.getByRole('tab',{name:'Git'}));expect(screen.queryByRole('button',{name:'Remove worktree'})).toBeNull();expect(mock.command).not.toHaveBeenCalled();
 });
});
