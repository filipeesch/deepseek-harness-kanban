import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { Board, HubState } from '../../shared/types.js';
import { KanbanError, invariant } from '../../shared/errors.js';
import { ownedSessionIds } from '../../domain/session-lineage.js';
import type { KanbanApp } from '../app.js';
import type { LocatedTask } from '../hub-repository.js';

export interface ToolArgs { board_id?: string; hub_id?: string; task_id?: string }

export function taskContext(app:KanbanApp,exec:ToolRunContext):LocatedTask|undefined{return exec.agent?app.locator.bySession(exec.agent.id):undefined;}

export function requireTask(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):LocatedTask{
 if(args.task_id){const located=app.hubs.findTask(args.task_id);invariant(located,'TASK_NOT_FOUND','Task does not exist.');return located;}
 const located=taskContext(app,exec);invariant(located,'MISSING_TASK_CONTEXT','Specify task_id or use a conversation belonging to a task.');return located;
}

export function resolveHub(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):{hubId:string;hub:HubState}{
 if(args.hub_id){const hub=app.hubs.requireHub(args.hub_id);return {hubId:hub.id,hub};}
 const located=taskContext(app,exec);if(located)return {hubId:located.hubId,hub:located.hub};
 const hubId=app.hubs.resolveHubId();return {hubId,hub:app.hubs.requireHub(hubId)};
}

export function resolveBoard(app:KanbanApp,args:ToolArgs,exec:ToolRunContext):{hubId:string;hub:HubState;board:Board}{
 const located=taskContext(app,exec);
 const boardId=args.board_id??located?.board.id;
 invariant(boardId,'BOARD_CONTEXT_REQUIRED','Discover a board with list_hubs and list_boards, then pass board_id.');
 if(args.hub_id){const hub=app.hubs.requireHub(args.hub_id);const board=hub.boards.find(value=>value.id===boardId);invariant(board,'BOARD_NOT_FOUND','Board does not exist in the selected Hub.');return {hubId:hub.id,hub,board};}
 const found=app.hubs.findBoard(boardId);
 invariant(found,'BOARD_NOT_FOUND','Board does not exist.',);
 return found;
}

export function boardSummary(board:Board,hub:HubState){return {id:board.id,hubId:hub.id,name:board.name,columns:board.workflow.columns.map(column=>({id:column.id,name:column.name,count:hub.tasks.filter(task=>task.boardId===board.id&&task.columnId===column.id).length}))};}

/**
 * Board administration writes are an ordinary-chat capability. A session owned by
 * a task, including a subagent descendant, is rejected before any board state is
 * read or changed; a lineage read failure fails closed.
 */
export async function assertBoardWriteAllowed(app:KanbanApp,exec:ToolRunContext):Promise<void>{
 const sessionId=exec.agent?.id;
 invariant(sessionId,'MISSING_SESSION','Board administration requires an owning native conversation.');
 if(app.locator.hasSession(sessionId))throw new KanbanError('BOARD_ADMIN_REQUIRES_ORDINARY_CHAT','Board changes are available only in an ordinary DSH chat, not in a task conversation.');
 const roots=app.locator.summaries().flatMap(summary=>summary.sessionIds);
 if(roots.length===0)return;
 let lineage;
 try{lineage=(await app.sessions.topology()).lineage;}
 catch(error){throw new KanbanError('BOARD_ADMIN_REQUIRES_ORDINARY_CHAT','Board changes require an ordinary DSH chat, and this conversation could not be verified as one.',{cause:error instanceof Error?error.message:String(error)});}
 if(ownedSessionIds(roots,lineage).has(sessionId))throw new KanbanError('BOARD_ADMIN_REQUIRES_ORDINARY_CHAT','Board changes are available only in an ordinary DSH chat, not in a task-owned conversation.');
}
