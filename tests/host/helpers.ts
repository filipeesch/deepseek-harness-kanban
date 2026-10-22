import { mkdtemp, mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import { BoardStore } from '../../src/domain/store.js';
import { KanbanApp } from '../../src/host/app.js';
import type { BoardState, Attention, Project, CreateWorktree } from '../../src/shared/types.js';
import type { StateStorage, SessionPort, GitPort, GitTree, WorkspacePort, WorkspaceInfo } from '../../src/shared/ports.js';
import { KanbanError } from '../../src/shared/errors.js';
export class MemoryStorage implements StateStorage {value:BoardState|null=null;async load(){return structuredClone(this.value);}async save(value:BoardState){this.value=structuredClone(value);}}
export class TestSessions implements SessionPort {
 dirs=new Map<string,string>();workspaceIds=new Map<string,string|undefined>();busy=new Set<string>();sent:Array<{id:string;text:string;requestId?:string}>=[];archived:string[]=[];failSend=false;private count=0;private requests=new Set<string>();
 async create(cwd:string,workspaceId?:string){const id='session-'+(++this.count);this.dirs.set(id,cwd);this.workspaceIds.set(id,workspaceId);return id;}
 async directory(id:string){const value=this.dirs.get(id);if(!value)throw new KanbanError('SESSION_NOT_FOUND','Missing test session.');return value;}
 async validateDirectory(id:string,expected:string):Promise<void>{
  let target:string;let current:string;
  try{target=await realpath(expected);current=await realpath(await this.directory(id));if(!(await stat(target)).isDirectory()||!(await stat(current)).isDirectory())throw new Error('Expected a directory.');}
  catch{throw new KanbanError('CONTEXT_UNAVAILABLE','The expected task directory or native conversation directory is missing or unavailable.');}
  if(current!==target)throw new KanbanError('CONTEXT_MISMATCH','The native conversation is not in the configured task directory.');
 }
 async setDirectory(id:string,cwd:string){if(this.busy.has(id))throw new KanbanError('SESSION_BUSY','Busy test session.');this.dirs.set(id,cwd);}
 async isIdle(id:string){return !this.busy.has(id);}
 async send(id:string,text:string,requestId?:string){if(this.failSend)throw new KanbanError('SEND_FAILED','Injected native admission failure.');if(requestId&&this.requests.has(requestId))return;if(requestId)this.requests.add(requestId);this.sent.push({id,text,requestId});}
 async archive(id:string){this.archived.push(id);}
 async attention(id:string):Promise<Attention>{return {running:this.busy.has(id),unread:false,awaitingReply:false,failed:false};}
 async directories(){return [...this.dirs].map(([sessionId,directory])=>({sessionId,directory}));}
}
export class TestGit implements GitPort {
 trees=new Map<string,GitTree>();created=0;removed:string[]=[];
 async branches(){return ['main','feature'];}
 async projectDirectory(project:Project,root?:string){return root?path.join(root,path.relative(project.gitRootPath,project.projectPath)):project.projectPath;}
 async inspect(_project:Project,root:string){const tree=this.trees.get(root);if(!tree)throw new KanbanError('NOT_WORKTREE','Not a test worktree.');return {...tree};}
 async create(project:Project,request:CreateWorktree){this.created++;await mkdir(await this.projectDirectory(project,request.path),{recursive:true});const tree={path:request.path,branch:request.branchName,dirty:false,commonDirectory:path.join(project.gitRootPath,'.git')};this.trees.set(request.path,tree);return tree;}
 async remove(_project:Project,root:string,discard:boolean){const tree=this.trees.get(root);if(tree?.dirty&&!discard)throw new KanbanError('DISCARD_REQUIRED','Confirm discard.',{path:root});this.trees.delete(root);this.removed.push(root);}
 async assertPolicy(){}
}
export class TestWorkspaces implements WorkspacePort {
 byPath=new Map<string,WorkspaceInfo>();byId=new Map<string,WorkspaceInfo>();deleted:string[]=[];private count=0;
 async ensure(path:string,title:string){const existing=this.byPath.get(path);if(existing)return {workspace:existing,owned:false};const workspace:WorkspaceInfo={id:'workspace-'+(++this.count),path,title,sessionIds:[]};this.byPath.set(path,workspace);this.byId.set(workspace.id,workspace);return {workspace,owned:true};}
 get(id:string){return this.byId.get(id);}
 async delete(id:string){this.deleted.push(id);const value=this.byId.get(id);if(value)this.byPath.delete(value.path);this.byId.delete(id);}
}
export async function fixture(){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'dsh-kanban-host-')));const gitRoot=path.join(root,'repo');const projectPath=path.join(gitRoot,'apps','web');await mkdir(projectPath,{recursive:true});const storage=new MemoryStorage();const store=await BoardStore.open(storage);const project=await store.saveProject({name:'Web',projectPath,gitRootPath:gitRoot});const sessions=new TestSessions();const git=new TestGit();const workspaces=new TestWorkspaces();const app=new KanbanApp(store,sessions,git,{},workspaces);return {root,gitRoot,projectPath,storage,store,project,sessions,git,workspaces,app,async close(){await app.close();if(path.dirname(root)!==await realpath(os.tmpdir())||!path.basename(root).startsWith('dsh-kanban-host-')||await realpath(root)!==root)throw new Error('Unsafe test cleanup target');await rm(root,{recursive:true,force:true});}};}
