import { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { BoardSnapshot, Command, Outcome, QuestionRound } from '../shared/types.js';
import { problem, KanbanError } from '../shared/errors.js';
import type { KanbanApp } from './app.js';
export class KanbanController extends TypertRemoteService {
 constructor(ctx:Context,private readonly app:KanbanApp){super(ctx,'kanbanController',{namespace:'kanban'});}
 private owner():void{if(this.ctx.invocation&&this.ctx.invocation.peer.principal.kind!=='owner')throw new KanbanError('FORBIDDEN','Kanban access requires the native host owner.');}
 private async attempt<T>(fn:()=>Promise<T>):Promise<Outcome<T>>{try{this.owner();return {ok:true,value:await fn()};}catch(error){return {ok:false,error:problem(error)};}}
 @Remote async snapshot():Promise<Outcome<BoardSnapshot>>{return this.attempt(()=>this.app.snapshot());}
 @Remote async command(request:Command):Promise<Outcome<BoardSnapshot>>{return this.attempt(()=>this.app.command(request));}
 @Remote async branches(request:{taskId:string}):Promise<Outcome<string[]>>{return this.attempt(()=>this.app.branches(request.taskId));}
 @Remote async worktreeDefault(request:{taskId:string}):Promise<Outcome<{branchName:string;path:string}>>{return this.attempt(()=>this.app.worktreeDefault(request.taskId));}
 @Remote async inferProject(request:{path:string}):Promise<Outcome<{projectPath:string;gitRootPath:string}>>{return this.attempt(()=>this.app.inferProject(request.path));}
 @Remote async questions(request:{sessionId:string}):Promise<Outcome<QuestionRound[]>>{return this.attempt(()=>this.app.rounds(request.sessionId));}
 @Remote({mode:'stream'}) async *follow(signal:AbortSignal):AsyncGenerator<BoardSnapshot>{
  this.owner();let dirty=true;let wake:(()=>void)|undefined;
  const changed=()=>{dirty=true;wake?.();};const off=this.app.subscribe(changed);
  signal.addEventListener('abort',changed,{once:true});
  try{while(!signal.aborted){if(dirty){dirty=false;yield await this.app.snapshot();continue;}await new Promise<void>(resolve=>{wake=resolve;if(dirty||signal.aborted)resolve();});wake=undefined;}}
  finally{off();signal.removeEventListener('abort',changed);wake?.();}
 }
}
declare module '@deepseek-ai/cordis' {interface Context {kanbanController:KanbanController}}
