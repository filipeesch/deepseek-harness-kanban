import {describe,expect,it} from 'vitest';
import {BoardStateSchema,initialState} from '../../src/domain/schema.js';

function state(){
  const value=initialState(); const time='2026-10-21T00:00:00.000Z';
  value.projects=[{id:'project',name:'Fixture',gitRootPath:'/fixture/repo',projectPath:'/fixture/repo/apps/api'}];
  value.tasks=[{id:'task',projectId:'project',title:'Fixture',description:'',columnId:value.workflow.initialColumnId,position:0,sessionIds:['session'],closedSessionIds:[],effectiveCwd:'/fixture/repo/apps/api',worktree:null,operation:null,createdAt:time,updatedAt:time}];
  return value;
}
const record={path:'/fixture/unclaimed',branch:'HEAD',error:{code:'UNCLAIMED_WORKTREE',message:'Left on disk without ownership or cleanup authority.'}};
describe('unclaimed worktree diagnostic persistence',()=>{
  it('is optional for existing records and round-trips strict diagnostic metadata',()=>{
    const before=state();expect(BoardStateSchema.parse(before).tasks[0]!.unclaimedWorktrees).toBeUndefined();
    before.tasks[0]!.unclaimedWorktrees=[record]; const parsed=BoardStateSchema.parse(JSON.parse(JSON.stringify(before)));
    expect(parsed.schemaVersion).toBe(2);expect(parsed.tasks[0]!.worktree).toBeNull();expect(parsed.tasks[0]!.unclaimedWorktrees).toEqual([record]);
  });
  it.each([{...record,owned:true},{...record,active:true},{...record,remove:true},{...record,path:'relative'},{...record,branch:''},{...record,error:{code:'',message:'Invalid'}}])('rejects authority or invalid fields in a diagnostic record',invalid=>{
    const value=state();(value.tasks[0] as unknown as {unclaimedWorktrees:unknown[]}).unclaimedWorktrees=[invalid];expect(()=>BoardStateSchema.parse(value)).toThrow();
  });
  it('preserves the independent absent-before-create journal alongside diagnostics',()=>{
    const value=state();value.tasks[0]!.unclaimedWorktrees=[record];value.tasks[0]!.operation={id:'operation',request:{kind:'create',mode:'existing',path:'/fixture/repo/attempt',branchName:'feature'},phase:'failed',targetPath:'/fixture/repo/attempt',previousDirectories:{},switchedSessionIds:[],archivedSessionIds:[],gitCompleted:false,createdAt:value.tasks[0]!.createdAt,createAttempt:{operationId:'operation',path:'/fixture/repo/attempt',gitRootPath:'/fixture/repo',branchName:'feature',mode:'existing',absentBefore:true}};
    const parsed=BoardStateSchema.parse(JSON.parse(JSON.stringify(value)));
    expect(parsed.tasks[0]!.operation!.createAttempt).toEqual(value.tasks[0]!.operation!.createAttempt);expect(parsed.tasks[0]!.unclaimedWorktrees).toEqual([record]);
  });
});
