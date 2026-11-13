import { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Command, FullHostSnapshot, HostSnapshot, LocalDriveRequest, LocalDriveResult, Outcome, ProjectLocation, QuestionDraftContent, QuestionFeedFrame, QuestionRound, ModelCatalog, SharingCommand, SnapshotRequest, StoredQuestionDraft, WorktreeDefaults } from '../shared/types.js';
import { problem, KanbanError } from '../shared/errors.js';
import type { KanbanApp } from './app.js';
import type { DeterministicStageReview, DeterministicVariablesView } from '../shared/deterministic.js';
export class KanbanController extends TypertRemoteService {
 constructor(ctx:Context,private readonly app:KanbanApp){super(ctx,'kanbanController',{namespace:'kanban'});}
 private owner():void{if(this.ctx.invocation&&this.ctx.invocation.peer.principal.kind!=='owner')throw new KanbanError('FORBIDDEN','Kanban access requires the native host owner.');}
 private async attempt<T>(fn:()=>Promise<T>):Promise<Outcome<T>>{try{this.owner();return {ok:true,value:await fn()};}catch(error){return {ok:false,error:problem(error)};}}
 @Remote async snapshot(request:SnapshotRequest={}):Promise<Outcome<FullHostSnapshot>>{return this.attempt(()=>this.app.snapshot(request));}
 @Remote async command(request:Command):Promise<Outcome<FullHostSnapshot>>{return this.attempt(()=>this.app.command(request));}
 @Remote async sharing(request:SharingCommand):Promise<Outcome<FullHostSnapshot>>{return this.attempt(()=>this.app.sharingCommand(request));}
 @Remote async branches(request:{taskId:string}):Promise<Outcome<string[]>>{return this.attempt(()=>this.app.branches(request.taskId));}
 @Remote async worktreeDefault(request:{taskId:string}):Promise<Outcome<WorktreeDefaults>>{return this.attempt(()=>this.app.worktreeDefault(request.taskId));}
 @Remote async detectProject(request:{path:string}):Promise<Outcome<ProjectLocation>>{return this.attempt(()=>this.app.detectProject(request.path));}
 @Remote async localDrive(request:LocalDriveRequest):Promise<Outcome<LocalDriveResult>>{return this.attempt(()=>this.app.localDrive(request));}
 @Remote async dismissQuestions(request:{sessionId:string;roundId:string}):Promise<Outcome<QuestionRound[]>>{return this.attempt(()=>this.app.dismissQuestions(request.sessionId,request.roundId));}
 @Remote async saveQuestionDraft(request:{sessionId:string;roundId:string;draft:QuestionDraftContent|null}):Promise<Outcome<StoredQuestionDraft|null>>{return this.attempt(()=>this.app.saveQuestionDraft(request.sessionId,request.roundId,request.draft));}
 @Remote async deterministicReview(request:{boardId:string;stageId:string;taskId?:string}):Promise<Outcome<DeterministicStageReview>>{return this.attempt(()=>this.app.deterministicReview(request));}
 @Remote async deterministicVariables(request:{taskId:string}):Promise<Outcome<DeterministicVariablesView>>{return this.attempt(()=>this.app.deterministicVariables(request.taskId));}
 @Remote async modelCatalog(request:{refresh?:boolean}):Promise<Outcome<ModelCatalog>>{return this.attempt(()=>this.app.modelCatalog(request.refresh===true));}
 @Remote({mode:'stream'}) async *follow(signal:AbortSignal):AsyncGenerator<HostSnapshot>{
  this.owner();let dirty=true;let wake:(()=>void)|undefined;let lastRevision=-1;
  const changed=()=>{dirty=true;wake?.();};const off=this.app.subscribe(changed);
  signal.addEventListener('abort',changed,{once:true});
  try{while(!signal.aborted){
   if(dirty){
    dirty=false;
    const snapshot=await this.app.snapshot();
    // A baseline always carries state; an update carries it only when the revision moved.
    const includeState=lastRevision!==snapshot.stateRevision;
    lastRevision=snapshot.stateRevision;
    if(includeState)yield snapshot;
    else{const {state:_state,...rest}=snapshot;yield rest;}
    continue;
   }
   await new Promise<void>(resolve=>{wake=resolve;if(dirty||signal.aborted)resolve();});wake=undefined;
  }}
  finally{off();signal.removeEventListener('abort',changed);wake?.();}
 }
 /**
  * One conversation's question projection, independent of board and attention work.
  * A baseline frame precedes updates; unrelated sessions never advance this revision.
  */
 @Remote({mode:'stream'}) async *questionsFollow(request:{sessionId:string},signal:AbortSignal):AsyncGenerator<QuestionFeedFrame>{
  this.owner();const sessionId=request.sessionId;
  let dirty=true;let first=true;let last=-1;let wake:(()=>void)|undefined;
  const changed=()=>{dirty=true;wake?.();};const off=this.app.questions.subscribe(changed);
  signal.addEventListener('abort',changed,{once:true});
  try{while(!signal.aborted){
   if(dirty){
    dirty=false;
    const revision=this.app.questions.revisionOf(sessionId);
    if(first||revision!==last){
     last=revision;
     const kind=first?'baseline':'update';
     const rounds=await this.app.rounds(sessionId);
     // Drafts travel only on the baseline: the form paints once with its round and
     // its draft, and a client's own write is never echoed back to it.
     // Drafts are best effort: a draft-read failure must never withhold the rounds
     // baseline and its Submit surface.
     const drafts=kind==='baseline'?await this.app.questionDrafts(sessionId).catch(()=>undefined):undefined;
     signal.throwIfAborted();
     // An empty draft map is the same as no drafts: keep the baseline shape it always had.
     yield {...(drafts===undefined||Object.keys(drafts).length===0?{kind,rounds}:{kind,rounds,drafts})};
     first=false;continue;
    }
   }
   await new Promise<void>(resolve=>{wake=resolve;if(dirty||signal.aborted)resolve();});wake=undefined;
  }}
  finally{off();signal.removeEventListener('abort',changed);wake?.();}
 }
}
declare module '@deepseek-ai/cordis' {interface Context {kanbanController:KanbanController}}
