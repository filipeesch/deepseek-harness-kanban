import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { KanbanApp } from '../app.js';
import type { BoardAdministration } from '../board-administration.js';
import { KanbanError } from '../../shared/errors.js';
import { discoveryTools } from './discovery.js';
import { cardTools } from './cards.js';
import { noteTools } from './notes.js';
import { boardTools } from './boards.js';
import { questionTools } from './questions.js';
import { transitionTools } from './transitions.js';
import { autoModeTools } from './auto-mode.js';
import { teamFileTools } from './team-files.js';
import { messageTools } from './messages.js';
import type { InterCardMessaging } from '../inter-card-messaging.js';

export function productToolDefinitions(app:KanbanApp,boards:BoardAdministration=app.boards,messaging?:InterCardMessaging):ToolDefinition[]{
 return [
  ...discoveryTools(app,boards),
  ...cardTools(app),
  ...noteTools(app),
  ...boardTools(app,boards),
  ...transitionTools(app),
  ...autoModeTools(app),
  ...teamFileTools(app),
  ...(messaging===undefined?[]:messageTools(messaging)),
  ...questionTools(),
 ];
}

export function registerProductTools(ctx:Context,app:KanbanApp,messaging?:InterCardMessaging):()=>void{
 const disposers:Array<()=>void>=[];
 try{for(const definition of productToolDefinitions(app,app.boards,messaging)){if(ctx.tools.get(definition.name))throw new KanbanError('TOOL_CONFLICT','Another plugin already provides '+definition.name+'.');disposers.push(ctx.tools.register(definition));}}
 catch(error){for(const off of disposers.reverse())off();throw error;}
 return()=>{for(const off of disposers.reverse())off();};
}
